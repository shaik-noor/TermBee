//! Login secrets live only in the OS keychain (Windows Credential Manager / macOS
//! Keychain). They are never written to TermBee's own files and never sent to the UI:
//! the UI only learns *whether* a secret is saved (see `SecretFlags`).

use crate::error::AppResult;
use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "app.termbee.desktop";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretKind {
    Password,
    Passphrase,
}

impl SecretKind {
    fn slug(self) -> &'static str {
        match self {
            SecretKind::Password => "password",
            SecretKind::Passphrase => "passphrase",
        }
    }
}

fn entry(host_id: &str, kind: SecretKind) -> AppResult<Entry> {
    Ok(Entry::new(
        SERVICE,
        &format!("host:{host_id}:{}", kind.slug()),
    )?)
}

pub fn set(host_id: &str, kind: SecretKind, value: &str) -> AppResult<()> {
    entry(host_id, kind)?.set_password(value)?;
    Ok(())
}

pub fn get(host_id: &str, kind: SecretKind) -> AppResult<Option<String>> {
    match entry(host_id, kind)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete(host_id: &str, kind: SecretKind) -> AppResult<()> {
    match entry(host_id, kind)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_all(host_id: &str) -> AppResult<()> {
    delete(host_id, SecretKind::Password)?;
    delete(host_id, SecretKind::Passphrase)
}

/// Windows' Remote Desktop client (mstsc) signs in with the credential stored under
/// `TERMSRV/<host>`, the same entry `cmdkey /generic:TERMSRV/<host>` writes. A saved RDP
/// password is mirrored there right before mstsc starts, so it never goes on a command line or
/// into the .rdp file. (On macOS, Windows App keeps its own keychain entry instead.)
#[cfg(windows)]
pub fn set_rdp_login(hostname: &str, username: &str, password: &str) -> AppResult<()> {
    Entry::new_with_target(&rdp_target(hostname), SERVICE, username)?.set_password(password)?;
    Ok(())
}

/// Removes the `TERMSRV/<host>` credential so Remote Desktop stops using a forgotten password.
#[cfg(windows)]
pub fn forget_rdp_login(hostname: &str) -> AppResult<()> {
    match Entry::new_with_target(&rdp_target(hostname), SERVICE, "")?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(not(windows))]
pub fn forget_rdp_login(_hostname: &str) -> AppResult<()> {
    Ok(())
}

#[cfg(windows)]
fn rdp_target(hostname: &str) -> String {
    format!("TERMSRV/{hostname}")
}
