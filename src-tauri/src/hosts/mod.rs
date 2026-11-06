//! Saved hosts ("the hive"). Metadata lives in `hosts.json`; secrets live in the keychain.

pub mod commands;
pub mod folders;

use crate::{
    error::{AppError, AppResult},
    secrets::{self, SecretKind},
    store,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AuthMethod {
    Password,
    Key { key_path: String },
}

/// How a host opens by default: an SSH terminal tab, an SFTP files tab, or the OS's Remote
/// Desktop client. SSH and SFTP hosts can always open the other kind of tab too.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Protocol {
    #[default]
    Ssh,
    Sftp,
    Rdp,
}

/// Which secrets are saved in the keychain for a host (never the secrets themselves).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretFlags {
    #[serde(default)]
    pub password: bool,
    #[serde(default)]
    pub passphrase: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    #[serde(default)]
    pub protocol: Protocol,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    /// The folder the host lives in, as a `/`-separated path (`Production/EU`); `None` is the
    /// top level. Older files used this for a flat "group", which reads as a top-level folder.
    #[serde(default)]
    pub group: Option<String>,
    /// Position within its folder (drag-and-drop order); ties sort by label.
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_color")]
    pub color: String,
    /// An icon key from the UI's icon set; `None` shows the label's initials.
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub saved_secrets: SecretFlags,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub last_connected_at: Option<DateTime<Utc>>,
}

fn default_color() -> String {
    "honey".into()
}

/// How a save request changes a stored secret.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum SecretUpdate {
    #[default]
    Keep,
    Set {
        value: String,
    },
    Clear,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInput {
    pub id: Option<String>,
    #[serde(default)]
    pub protocol: Protocol,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub password: SecretUpdate,
    #[serde(default)]
    pub passphrase: SecretUpdate,
}

fn clean_opt(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl HostInput {
    fn validate(&self) -> AppResult<()> {
        if self.hostname.trim().is_empty() {
            return Err(AppError::Invalid("Enter a hostname or IP address.".into()));
        }
        if self.hostname.trim().contains(char::is_whitespace) {
            return Err(AppError::Invalid(
                "The hostname can't contain spaces.".into(),
            ));
        }
        if self.port == 0 {
            return Err(AppError::Invalid(
                "The port must be between 1 and 65535.".into(),
            ));
        }
        if self.username.trim().is_empty() {
            return Err(AppError::Invalid("Enter the username to log in as.".into()));
        }
        if self.protocol == Protocol::Rdp {
            if self.auth != AuthMethod::Password {
                return Err(AppError::Invalid(
                    "Remote Desktop hosts sign in with a password.".into(),
                ));
            }
            // The username goes into a line-based .rdp file.
            if self.username.chars().any(char::is_control) {
                return Err(AppError::Invalid(
                    "The username can't contain line breaks.".into(),
                ));
            }
        }
        if let AuthMethod::Key { key_path } = &self.auth {
            if key_path.trim().is_empty() {
                return Err(AppError::Invalid("Choose a private key file.".into()));
            }
        }
        if let Some(icon) = &self.icon {
            if icon.len() > 32 || !icon.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                return Err(AppError::Invalid("That icon isn't available.".into()));
            }
        }
        Ok(())
    }
}

/// Everything the sidebar needs after a reorganize: hosts plus every folder path (including
/// empty folders, which only exist in `folders.json`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hive {
    pub hosts: Vec<Host>,
    pub folders: Vec<String>,
}

pub struct HostStore {
    path: PathBuf,
    hosts: Mutex<Vec<Host>>,
    folders_path: PathBuf,
    /// Folders created explicitly. Folders that hold hosts are also derived from them.
    folders: Mutex<Vec<String>>,
}

impl HostStore {
    pub fn open(path: PathBuf, folders_path: PathBuf) -> AppResult<Self> {
        let hosts = store::load(&path)?;
        let folders = store::load(&folders_path)?;
        Ok(Self {
            path,
            hosts: Mutex::new(hosts),
            folders_path,
            folders: Mutex::new(folders),
        })
    }

    pub fn get(&self, id: &str) -> AppResult<Host> {
        self.hosts
            .lock()
            .unwrap()
            .iter()
            .find(|h| h.id == id)
            .cloned()
            .ok_or_else(|| AppError::NotFound("That host no longer exists.".into()))
    }

    pub fn list(&self) -> Vec<Host> {
        self.hosts.lock().unwrap().clone()
    }

    pub fn save(&self, input: HostInput) -> AppResult<Host> {
        input.validate()?;
        let group = folders::normalize_opt(input.group.as_deref())?;
        let now = Utc::now();
        let mut hosts = self.hosts.lock().unwrap();

        let existing = input
            .id
            .as_deref()
            .and_then(|id| hosts.iter().position(|h| h.id == id));
        let previous = existing.map(|i| hosts[i].clone());
        let (id, created_at, flags, last) = match &previous {
            Some(h) => (
                h.id.clone(),
                h.created_at,
                h.saved_secrets,
                h.last_connected_at,
            ),
            None => (
                uuid::Uuid::new_v4().to_string(),
                now,
                SecretFlags::default(),
                None,
            ),
        };

        let mut flags = flags;
        apply_secret(
            &id,
            SecretKind::Password,
            &input.password,
            &mut flags.password,
        )?;
        apply_secret(
            &id,
            SecretKind::Passphrase,
            &input.passphrase,
            &mut flags.passphrase,
        )?;
        // A host that switched auth method shouldn't keep the other method's secret around.
        match input.auth {
            AuthMethod::Password if flags.passphrase => {
                secrets::delete(&id, SecretKind::Passphrase)?;
                flags.passphrase = false;
            }
            AuthMethod::Key { .. } if flags.password => {
                secrets::delete(&id, SecretKind::Password)?;
                flags.password = false;
            }
            _ => {}
        }

        // New hosts, and hosts moved to another folder, go to the end of that folder.
        let order = match &previous {
            Some(h) if h.group == group => h.order,
            _ => folders::next_order(&hosts, group.as_deref()),
        };
        let label = input.label.trim();
        let host = Host {
            id: id.clone(),
            protocol: input.protocol,
            label: if label.is_empty() {
                input.hostname.trim().to_string()
            } else {
                label.to_string()
            },
            hostname: input.hostname.trim().to_string(),
            port: input.port,
            username: input.username.trim().to_string(),
            auth: match input.auth {
                AuthMethod::Key { key_path } => AuthMethod::Key {
                    key_path: key_path.trim().to_string(),
                },
                other => other,
            },
            group,
            order,
            tags: input
                .tags
                .into_iter()
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect(),
            color: input.color,
            icon: clean_opt(input.icon),
            notes: clean_opt(input.notes),
            favorite: input.favorite,
            saved_secrets: flags,
            created_at,
            updated_at: now,
            last_connected_at: last,
        };

        match existing {
            Some(i) => hosts[i] = host.clone(),
            None => hosts.push(host.clone()),
        }
        store::save(&self.path, &hosts)?;

        // Remote Desktop reads its own copy of the password (see `secrets::set_rdp_login`).
        // Drop it when it would go stale: password forgotten, address changed, or no longer RDP.
        if let Some(old) = previous.filter(|h| h.protocol == Protocol::Rdp) {
            let still_valid = host.protocol == Protocol::Rdp
                && host.hostname == old.hostname
                && host.saved_secrets.password;
            if !still_valid {
                secrets::forget_rdp_login(&old.hostname)?;
            }
        }
        Ok(host)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let mut hosts = self.hosts.lock().unwrap();
        let Some(index) = hosts.iter().position(|h| h.id == id) else {
            return Err(AppError::NotFound("That host no longer exists.".into()));
        };
        let removed = hosts.remove(index);
        store::save(&self.path, &hosts)?;
        drop(hosts);
        if removed.protocol == Protocol::Rdp {
            secrets::forget_rdp_login(&removed.hostname)?;
        }
        secrets::delete_all(id)
    }

    /// Record a successful login, optionally saving the secret the user typed.
    pub fn record_login(&self, id: &str, remembered: Option<(SecretKind, &str)>) -> AppResult<()> {
        let mut hosts = self.hosts.lock().unwrap();
        let Some(host) = hosts.iter_mut().find(|h| h.id == id) else {
            return Ok(());
        };
        host.last_connected_at = Some(Utc::now());
        if let Some((kind, value)) = remembered {
            secrets::set(id, kind, value)?;
            match kind {
                SecretKind::Password => host.saved_secrets.password = true,
                SecretKind::Passphrase => host.saved_secrets.passphrase = true,
            }
        }
        store::save(&self.path, &hosts)
    }

    /// The keychain no longer has a secret we thought was saved (e.g. the user cleared it
    /// in Credential Manager) — fix the flag so the UI stops claiming it's saved.
    pub fn forget_secret_flag(&self, id: &str, kind: SecretKind) {
        let mut hosts = self.hosts.lock().unwrap();
        if let Some(host) = hosts.iter_mut().find(|h| h.id == id) {
            match kind {
                SecretKind::Password => host.saved_secrets.password = false,
                SecretKind::Passphrase => host.saved_secrets.passphrase = false,
            }
            let _ = store::save(&self.path, &hosts);
        }
    }
}

fn apply_secret(
    id: &str,
    kind: SecretKind,
    update: &SecretUpdate,
    flag: &mut bool,
) -> AppResult<()> {
    match update {
        SecretUpdate::Keep => {}
        SecretUpdate::Set { value } if value.is_empty() => {}
        SecretUpdate::Set { value } => {
            secrets::set(id, kind, value)?;
            *flag = true;
        }
        SecretUpdate::Clear => {
            secrets::delete(id, kind)?;
            *flag = false;
        }
    }
    Ok(())
}
