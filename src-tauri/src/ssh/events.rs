//! Everything a session reports to the UI, streamed over one Tauri `Channel` per session.
//! Mirrored by `SessionEvent` in `src/lib/ipc/types.ts` — keep them in sync.

use crate::secrets::SecretKind;
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Connecting,
    Handshake,
    Authenticating,
    Connected,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HostKeyKind {
    /// First time we see this host.
    Unknown,
    /// The host presented a different key than the one we trusted.
    Changed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SessionEvent {
    Phase {
        phase: Phase,
    },
    /// The session is paused until the UI answers with `ssh_host_key_decision`.
    HostKey {
        kind: HostKeyKind,
        hostname: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
        previous_fingerprint: Option<String>,
    },
    /// Terminal output (already UTF-8 decoded, split sequences reassembled).
    Data {
        data: String,
    },
    /// No saved secret: the UI should ask for one and reconnect.
    SecretRequired {
        secret: SecretKind,
        message: String,
    },
    /// The server rejected the login. `secret` says what to ask for on retry, if anything.
    AuthFailed {
        secret: Option<SecretKind>,
        message: String,
    },
    Error {
        message: String,
    },
    Closed {
        exit_status: Option<u32>,
    },
}
