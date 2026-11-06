//! Trust-on-first-use host key store. TermBee keeps its own `known_hosts.json`, and also
//! honours the user's OpenSSH `~/.ssh/known_hosts` so hosts they already trust in a
//! terminal don't prompt again.

use crate::{error::AppResult, store};
use chrono::{DateTime, Utc};
use russh::keys::{HashAlg, PublicKey};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub hostname: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    /// OpenSSH public-key line (`ssh-ed25519 AAAA…`), the value actually compared.
    pub key: String,
    pub added_at: DateTime<Utc>,
}

pub enum Verdict {
    Trusted,
    Unknown,
    Changed {
        previous_fingerprint: Option<String>,
    },
}

pub struct KeyInfo {
    pub algorithm: String,
    pub fingerprint: String,
    pub openssh: String,
}

pub fn describe(key: &PublicKey) -> KeyInfo {
    KeyInfo {
        algorithm: key.algorithm().to_string(),
        fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
        openssh: key.to_openssh().unwrap_or_default(),
    }
}

pub struct KnownHosts {
    path: PathBuf,
    entries: Mutex<Vec<KnownHost>>,
}

fn same_host(e: &KnownHost, hostname: &str, port: u16) -> bool {
    e.port == port && e.hostname.eq_ignore_ascii_case(hostname)
}

impl KnownHosts {
    pub fn open(path: PathBuf) -> AppResult<Self> {
        let entries = store::load(&path)?;
        Ok(Self {
            path,
            entries: Mutex::new(entries),
        })
    }

    pub fn list(&self) -> Vec<KnownHost> {
        self.entries.lock().unwrap().clone()
    }

    pub fn check(&self, hostname: &str, port: u16, key: &PublicKey) -> Verdict {
        let info = describe(key);
        {
            let entries = self.entries.lock().unwrap();
            let recorded: Vec<&KnownHost> = entries
                .iter()
                .filter(|e| same_host(e, hostname, port))
                .collect();
            if recorded.iter().any(|e| e.key == info.openssh) {
                return Verdict::Trusted;
            }
            // A different key of the SAME algorithm is a real change (possible MITM). A
            // new algorithm alone is normal (the server just offered another key type).
            if let Some(prev) = recorded.iter().find(|e| e.algorithm == info.algorithm) {
                return Verdict::Changed {
                    previous_fingerprint: Some(prev.fingerprint.clone()),
                };
            }
        }
        match russh::keys::check_known_hosts(hostname, port, key) {
            Ok(true) => {
                // Already trusted in OpenSSH — adopt it silently.
                let _ = self.trust(hostname, port, key);
                Verdict::Trusted
            }
            Err(russh::keys::Error::KeyChanged { .. }) => Verdict::Changed {
                previous_fingerprint: None,
            },
            _ => Verdict::Unknown,
        }
    }

    /// Trust `key` for this host, replacing any older key of the same algorithm.
    pub fn trust(&self, hostname: &str, port: u16, key: &PublicKey) -> AppResult<()> {
        let info = describe(key);
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|e| !(same_host(e, hostname, port) && e.algorithm == info.algorithm));
        entries.push(KnownHost {
            hostname: hostname.to_ascii_lowercase(),
            port,
            algorithm: info.algorithm,
            fingerprint: info.fingerprint,
            key: info.openssh,
            added_at: Utc::now(),
        });
        store::save(&self.path, &entries)
    }

    pub fn forget(&self, hostname: &str, port: u16) -> AppResult<()> {
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|e| !same_host(e, hostname, port));
        store::save(&self.path, &entries)
    }
}
