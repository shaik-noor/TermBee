//! Remote Desktop hosts open in the OS's own RDP client: `mstsc` on Windows, Microsoft's
//! Windows App on macOS. TermBee writes a small `.rdp` file (address, username and display
//! settings, never a secret) and hands it over. On Windows a saved password reaches mstsc
//! through the `TERMSRV/<host>` keychain entry (`secrets::set_rdp_login`).

pub mod commands;

use crate::{
    error::{AppError, AppResult},
    hosts::Host,
};
use std::path::{Path, PathBuf};

pub const DEFAULT_PORT: u16 = 3389;

/// The contents of the `.rdp` file for a host.
pub fn rdp_file(host: &Host) -> String {
    let address = match host.port {
        DEFAULT_PORT => host.hostname.clone(),
        // IPv6 literals need brackets before a port.
        port if host.hostname.contains(':') => format!("[{}]:{port}", host.hostname),
        port => format!("{}:{port}", host.hostname),
    };
    let lines = [
        format!("full address:s:{address}"),
        format!("username:s:{}", host.username),
        // Windowed, and the remote resolution follows the window as it's resized.
        "screen mode id:i:1".into(),
        "dynamic resolution:i:1".into(),
        "session bpp:i:32".into(),
        "redirectclipboard:i:1".into(),
        "autoreconnection enabled:i:1".into(),
        "prompt for credentials:i:0".into(),
        // Warn (don't silently connect) if the server's identity can't be verified.
        "authentication level:i:2".into(),
    ];
    let mut out = lines.join("\r\n");
    out.push_str("\r\n");
    out
}

/// Writes the host's `.rdp` file to TermBee's temp folder and returns its path. It's
/// rewritten on every connect, so edits to the host apply right away.
fn write_rdp_file(host: &Host) -> AppResult<PathBuf> {
    let dir = std::env::temp_dir().join("termbee-rdp");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.rdp", host.id));
    // UTF-16 LE with a BOM, like the files Windows itself writes; every RDP client reads it.
    let mut bytes = vec![0xFF, 0xFE];
    for unit in rdp_file(host).encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    std::fs::write(&path, bytes)?;
    Ok(path)
}

#[cfg(windows)]
fn launch(file: &Path) -> AppResult<()> {
    // Use the full path so a stray `mstsc.exe` elsewhere on PATH can't be picked up.
    let root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let mstsc = root.join("System32").join("mstsc.exe");
    if !mstsc.is_file() {
        return Err(AppError::ClientMissing(
            "Remote Desktop Connection (mstsc.exe) isn't available on this PC.".into(),
        ));
    }
    let mut child = std::process::Command::new(mstsc).arg(file).spawn()?;
    // Reap it when the user closes Remote Desktop.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Bundle id of Microsoft's Windows App (formerly Microsoft Remote Desktop) on macOS.
#[cfg(target_os = "macos")]
const WINDOWS_APP: &str = "com.microsoft.rdc.macos";

#[cfg(target_os = "macos")]
fn launch(file: &Path) -> AppResult<()> {
    let out = std::process::Command::new("/usr/bin/open")
        .args(["-b", WINDOWS_APP])
        .arg(file)
        .output()?;
    if out.status.success() {
        return Ok(());
    }
    Err(AppError::ClientMissing(
        "Remote Desktop on a Mac needs Microsoft's free Windows App. Install it from the App \
         Store, then connect again."
            .into(),
    ))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn launch(_file: &Path) -> AppResult<()> {
    Err(AppError::Invalid(
        "Remote Desktop isn't supported on this system yet.".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hosts::{AuthMethod, Protocol, SecretFlags};

    fn host(hostname: &str, port: u16) -> Host {
        Host {
            id: "id".into(),
            protocol: Protocol::Rdp,
            label: "win".into(),
            hostname: hostname.into(),
            port,
            username: r"CORP\bee".into(),
            auth: AuthMethod::Password,
            group: None,
            order: 0,
            tags: vec![],
            color: "honey".into(),
            icon: None,
            notes: None,
            favorite: false,
            saved_secrets: SecretFlags::default(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            last_connected_at: None,
        }
    }

    #[test]
    fn default_port_is_left_out() {
        let file = rdp_file(&host("win.example.com", 3389));
        assert!(file.starts_with("full address:s:win.example.com\r\n"));
        assert!(file.contains("username:s:CORP\\bee\r\n"));
        assert!(!file.contains("password"));
    }

    #[test]
    fn custom_port_and_ipv6() {
        assert!(rdp_file(&host("10.0.0.5", 3390)).starts_with("full address:s:10.0.0.5:3390\r\n"));
        assert!(rdp_file(&host("fe80::1", 3390)).starts_with("full address:s:[fe80::1]:3390\r\n"));
    }
}
