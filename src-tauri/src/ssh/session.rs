//! One SSH session = one task: TCP → handshake (host-key check) → login → PTY shell, then a
//! select loop that pumps output to the UI and input/resizes to the server. A files tab asks
//! for the SFTP subsystem instead of a shell; its `SftpSession` is registered with the
//! manager so the `sftp_*` commands can use it while the task waits for close.

use super::{
    events::{HostKeyKind, Phase, SessionEvent},
    known_hosts::{describe, KnownHosts, Verdict},
    manager::{SessionCommand, SessionManager},
    utf8::Utf8Stream,
};
use crate::{
    hosts::{AuthMethod, HostStore},
    secrets::{self, SecretKind},
};
use russh::{
    client::{self, AuthResult, KeyboardInteractiveAuthResponse},
    keys::{PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate},
    ChannelMsg, Disconnect, MethodKind,
};
use russh_sftp::client::SftpSession;
use serde::Deserialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::ipc::Channel;
use tokio::{
    net::TcpStream,
    sync::{mpsc, Notify},
};

const TCP_TIMEOUT: Duration = Duration::from_secs(12);
const TERM: &str = "xterm-256color";

/// What a session opens once logged in.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    /// An interactive shell in a PTY (a terminal tab).
    #[default]
    Shell,
    /// The SFTP subsystem (a files tab).
    Sftp,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    #[serde(default)]
    pub mode: SessionMode,
    /// Saved host this connection belongs to (enables keychain secrets + "last used").
    pub host_id: Option<String>,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    /// A secret the user just typed; overrides the keychain for this attempt.
    pub password: Option<String>,
    pub passphrase: Option<String>,
    /// Save the typed secret to the keychain once the login succeeds.
    #[serde(default)]
    pub remember: bool,
    pub cols: u32,
    pub rows: u32,
}

pub struct SessionContext {
    pub id: String,
    pub request: ConnectRequest,
    pub events: Channel<SessionEvent>,
    pub manager: Arc<SessionManager>,
    pub known_hosts: Arc<KnownHosts>,
    pub hosts: Arc<HostStore>,
    pub commands: mpsc::UnboundedReceiver<SessionCommand>,
    pub cancel: Arc<Notify>,
}

/// Why a session stopped before its shell opened.
enum Stop {
    Cancelled,
    Report(SessionEvent),
}

fn fail(message: impl Into<String>) -> Stop {
    Stop::Report(SessionEvent::Error {
        message: message.into(),
    })
}

struct Client {
    session_id: String,
    hostname: String,
    port: u16,
    known_hosts: Arc<KnownHosts>,
    manager: Arc<SessionManager>,
    events: Channel<SessionEvent>,
    rejected: Arc<AtomicBool>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key: PublicKey = match server_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            PublicKeyOrCertificate::Certificate(cert) => PublicKey::from(cert.public_key().clone()),
        };
        let (kind, previous_fingerprint) =
            match self.known_hosts.check(&self.hostname, self.port, &key) {
                Verdict::Trusted => return Ok(true),
                Verdict::Unknown => (HostKeyKind::Unknown, None),
                Verdict::Changed {
                    previous_fingerprint,
                } => (HostKeyKind::Changed, previous_fingerprint),
            };
        let info = describe(&key);
        let answer = self.manager.await_host_key(&self.session_id);
        let _ = self.events.send(SessionEvent::HostKey {
            kind,
            hostname: self.hostname.clone(),
            port: self.port,
            algorithm: info.algorithm,
            fingerprint: info.fingerprint,
            previous_fingerprint,
        });
        let accepted = answer.await.unwrap_or(false);
        if accepted {
            if let Err(e) = self.known_hosts.trust(&self.hostname, self.port, &key) {
                log::warn!("could not save host key for {}: {e}", self.hostname);
            }
        } else {
            self.rejected.store(true, Ordering::SeqCst);
        }
        Ok(accepted)
    }

    async fn auth_banner(
        &mut self,
        banner: &str,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let text = banner.replace("\r\n", "\n").replace('\n', "\r\n");
        let _ = self.events.send(SessionEvent::Data { data: text });
        Ok(())
    }
}

pub async fn run(ctx: SessionContext) {
    let SessionContext {
        id,
        request,
        events,
        manager,
        known_hosts,
        hosts,
        mut commands,
        cancel,
    } = ctx;

    let established = tokio::select! {
        r = establish(&id, &request, &events, &manager, &known_hosts, &hosts) => r,
        _ = cancel.notified() => Err(Stop::Cancelled),
    };

    let exit_status = match established {
        Ok((handle, channel)) => {
            let exit = match request.mode {
                SessionMode::Shell => {
                    let _ = events.send(SessionEvent::Phase {
                        phase: Phase::Connected,
                    });
                    shell_loop(channel, &events, &mut commands, &cancel).await
                }
                SessionMode::Sftp => {
                    sftp_loop(&id, channel, &handle, &events, &manager, &cancel).await;
                    None
                }
            };
            let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
            exit
        }
        Err(Stop::Cancelled) => None,
        Err(Stop::Report(event)) => {
            let _ = events.send(event);
            None
        }
    };

    let _ = events.send(SessionEvent::Closed { exit_status });
    manager.remove(&id);
}

async fn establish(
    id: &str,
    req: &ConnectRequest,
    events: &Channel<SessionEvent>,
    manager: &Arc<SessionManager>,
    known_hosts: &Arc<KnownHosts>,
    hosts: &HostStore,
) -> Result<(client::Handle<Client>, russh::Channel<client::Msg>), Stop> {
    let target = format!("{}:{}", req.hostname, req.port);
    let _ = events.send(SessionEvent::Phase {
        phase: Phase::Connecting,
    });

    let stream = match tokio::time::timeout(TCP_TIMEOUT, TcpStream::connect((req.hostname.as_str(), req.port))).await {
        Err(_) => {
            return Err(fail(format!(
                "{target} didn't answer within {} seconds. Check the address, your VPN, or the firewall.",
                TCP_TIMEOUT.as_secs()
            )))
        }
        Ok(Err(e)) => return Err(fail(friendly_io(&e, &target))),
        Ok(Ok(s)) => s,
    };
    let _ = stream.set_nodelay(true); // no Nagle: keystrokes go out immediately

    let _ = events.send(SessionEvent::Phase {
        phase: Phase::Handshake,
    });
    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    });
    let rejected = Arc::new(AtomicBool::new(false));
    let handler = Client {
        session_id: id.to_string(),
        hostname: req.hostname.clone(),
        port: req.port,
        known_hosts: known_hosts.clone(),
        manager: manager.clone(),
        events: events.clone(),
        rejected: rejected.clone(),
    };

    let handshake_error = |e: russh::Error| {
        if rejected.load(Ordering::SeqCst) {
            fail("Connection cancelled: the server's host key wasn't trusted.")
        } else {
            fail(format!("The SSH handshake with {target} failed: {e}"))
        }
    };

    let mut handle = client::connect_stream(config, stream, handler)
        .await
        .map_err(&handshake_error)?;

    let _ = events.send(SessionEvent::Phase {
        phase: Phase::Authenticating,
    });
    authenticate(&mut handle, req, hosts)
        .await
        .map_err(|stop| match stop {
            Stop::Report(SessionEvent::Error { message }) if rejected.load(Ordering::SeqCst) => {
                let _ = message;
                fail("Connection cancelled: the server's host key wasn't trusted.")
            }
            other => other,
        })?;

    let channel = handle.channel_open_session().await.map_err(|e| {
        fail(format!(
            "Logged in, but the server wouldn't open a session: {e}"
        ))
    })?;
    match req.mode {
        SessionMode::Shell => {
            channel
                .request_pty(false, TERM, req.cols.max(2), req.rows.max(2), 0, 0, &[])
                .await
                .map_err(|e| fail(format!("The server refused a terminal (PTY): {e}")))?;
            channel
                .request_shell(true)
                .await
                .map_err(|e| fail(format!("The server refused to start a shell: {e}")))?;
        }
        SessionMode::Sftp => channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| fail(format!("{target} doesn't offer SFTP file access: {e}")))?,
    }
    Ok((handle, channel))
}

async fn authenticate(
    handle: &mut client::Handle<Client>,
    req: &ConnectRequest,
    hosts: &HostStore,
) -> Result<(), Stop> {
    let who = format!("{}@{}", req.username, req.hostname);
    let ssh_err = |e: russh::Error| fail(format!("Login to {who} failed: {e}"));

    let remembered: Option<(SecretKind, String)> = match &req.auth {
        AuthMethod::Password => {
            let (password, typed) = match &req.password {
                Some(p) => (p.clone(), true),
                None => match saved_secret(req, hosts, SecretKind::Password)? {
                    Some(p) => (p, false),
                    None => {
                        return Err(Stop::Report(SessionEvent::SecretRequired {
                            secret: SecretKind::Password,
                            message: format!("Enter the password for {who}."),
                        }))
                    }
                },
            };
            if !password_login(handle, &req.username, &password)
                .await
                .map_err(ssh_err)?
            {
                return Err(Stop::Report(SessionEvent::AuthFailed {
                    secret: Some(SecretKind::Password),
                    message: format!("The server didn't accept that password for {who}."),
                }));
            }
            typed.then_some((SecretKind::Password, password))
        }
        AuthMethod::Key { key_path } => {
            let path = expand_home(key_path);
            let (passphrase, typed) = match &req.passphrase {
                Some(p) => (Some(p.clone()), true),
                None => (saved_secret(req, hosts, SecretKind::Passphrase)?, false),
            };
            let key = match russh::keys::load_secret_key(&path, passphrase.as_deref()) {
                Ok(k) => k,
                Err(russh::keys::Error::KeyIsEncrypted) => {
                    return Err(Stop::Report(SessionEvent::SecretRequired {
                        secret: SecretKind::Passphrase,
                        message: "This private key is protected. Enter its passphrase.".into(),
                    }))
                }
                Err(russh::keys::Error::IO(e)) => {
                    return Err(fail(format!(
                        "Couldn't open the key file {}: {e}",
                        path.display()
                    )))
                }
                Err(e) if passphrase.is_some() => {
                    log::debug!("key load failed: {e}");
                    return Err(Stop::Report(SessionEvent::AuthFailed {
                        secret: Some(SecretKind::Passphrase),
                        message: "That passphrase didn't unlock the key.".into(),
                    }));
                }
                Err(e) => {
                    return Err(fail(format!(
                        "Couldn't read the key {}: {e}",
                        path.display()
                    )))
                }
            };
            let hash = handle
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten();
            let result = handle
                .authenticate_publickey(
                    &req.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(ssh_err)?;
            if !result.success() {
                return Err(Stop::Report(SessionEvent::AuthFailed {
                    secret: None,
                    message: format!(
                        "{who} didn't accept the key {}. Check that its public key is in the server's ~/.ssh/authorized_keys.",
                        path.display()
                    ),
                }));
            }
            match (typed, passphrase) {
                (true, Some(p)) => Some((SecretKind::Passphrase, p)),
                _ => None,
            }
        }
    };

    if let Some(host_id) = &req.host_id {
        let save = if req.remember {
            remembered.as_ref().map(|(k, v)| (*k, v.as_str()))
        } else {
            None
        };
        if let Err(e) = hosts.record_login(host_id, save) {
            log::warn!("could not record login for host {host_id}: {e}");
        }
    }
    Ok(())
}

fn saved_secret(
    req: &ConnectRequest,
    hosts: &HostStore,
    kind: SecretKind,
) -> Result<Option<String>, Stop> {
    let Some(id) = &req.host_id else {
        return Ok(None);
    };
    match secrets::get(id, kind) {
        Ok(Some(v)) => Ok(Some(v)),
        Ok(None) => {
            hosts.forget_secret_flag(id, kind);
            Ok(None)
        }
        Err(e) => Err(fail(format!(
            "Couldn't read the saved secret from the keychain: {e}"
        ))),
    }
}

/// Password auth, falling back to keyboard-interactive (many servers only offer that).
async fn password_login(
    handle: &mut client::Handle<Client>,
    user: &str,
    password: &str,
) -> Result<bool, russh::Error> {
    match handle.authenticate_password(user, password).await? {
        AuthResult::Success => return Ok(true),
        AuthResult::Failure {
            remaining_methods, ..
        } => {
            if !remaining_methods.contains(&MethodKind::KeyboardInteractive) {
                return Ok(false);
            }
        }
    }
    let mut response = handle
        .authenticate_keyboard_interactive_start(user, None::<String>)
        .await?;
    for _ in 0..4 {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers = prompts
                    .iter()
                    .map(|p| {
                        if p.echo {
                            String::new()
                        } else {
                            password.to_string()
                        }
                    })
                    .collect();
                response = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await?;
            }
        }
    }
    Ok(false)
}

async fn shell_loop(
    mut channel: russh::Channel<client::Msg>,
    events: &Channel<SessionEvent>,
    commands: &mut mpsc::UnboundedReceiver<SessionCommand>,
    cancel: &Notify,
) -> Option<u32> {
    let mut decoder = Utf8Stream::default();
    let mut exit_status = None;
    loop {
        tokio::select! {
            msg = channel.wait() => match msg {
                Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    let text = decoder.decode(&data);
                    if !text.is_empty() && events.send(SessionEvent::Data { data: text }).is_err() {
                        break; // the window that owned this session is gone
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status: code }) => exit_status = Some(code),
                Some(ChannelMsg::Close) | None => break,
                _ => {}
            },
            cmd = commands.recv() => match cmd {
                Some(SessionCommand::Write(bytes)) => {
                    if channel.data_bytes(bytes).await.is_err() {
                        break;
                    }
                }
                Some(SessionCommand::Resize { cols, rows }) => {
                    let _ = channel.window_change(cols.max(2), rows.max(2), 0, 0).await;
                }
                None => break,
            },
            _ = cancel.notified() => {
                let _ = channel.close().await;
                break;
            }
        }
    }
    exit_status
}

/// Starts SFTP on the channel and keeps it available to the `sftp_*` commands until the tab
/// closes it or the connection drops.
async fn sftp_loop(
    id: &str,
    channel: russh::Channel<client::Msg>,
    handle: &client::Handle<Client>,
    events: &Channel<SessionEvent>,
    manager: &SessionManager,
    cancel: &Notify,
) {
    let sftp = match SftpSession::new(channel.into_stream()).await {
        Ok(s) => Arc::new(s),
        Err(e) => {
            let _ = events.send(SessionEvent::Error {
                message: format!("The server's SFTP service didn't start: {e}"),
            });
            return;
        }
    };
    sftp.set_timeout(30);
    manager.insert_sftp(id, sftp.clone());
    let _ = events.send(SessionEvent::Phase {
        phase: Phase::Connected,
    });
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    loop {
        tokio::select! {
            _ = cancel.notified() => break,
            _ = tick.tick() => if handle.is_closed() { break },
        }
    }
    let _ = sftp.close().await;
}

fn expand_home(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn friendly_io(e: &std::io::Error, target: &str) -> String {
    use std::io::ErrorKind::*;
    match e.kind() {
        ConnectionRefused => {
            format!("{target} refused the connection. Is SSH running on that port?")
        }
        TimedOut => format!("{target} timed out. Check the address, your VPN, or the firewall."),
        HostUnreachable | NetworkUnreachable => {
            format!("Can't reach {target} from this network. Are you on the right VPN?")
        }
        PermissionDenied => format!(
            "This computer blocked the connection to {target} (firewall or security policy)."
        ),
        _ => {
            let raw = e.to_string();
            let lower = raw.to_lowercase();
            if lower.contains("no such host")
                || lower.contains("not known")
                || lower.contains("failed to lookup")
                || lower.contains("nodename")
            {
                format!("Couldn't find {target}. Check the hostname spelling or your DNS/VPN.")
            } else {
                format!("Couldn't connect to {target}: {raw}")
            }
        }
    }
}
