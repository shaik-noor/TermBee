//! One error type for every command, serialized as `{ kind, message }` so the UI can
//! branch on `kind` and show `message` as-is (messages are written for humans).

use serde::ser::SerializeStruct;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    /// An app TermBee hands off to (the Remote Desktop client) isn't installed.
    #[error("{0}")]
    ClientMissing(String),
    /// The SSH/SFTP server refused or failed an operation.
    #[error("{0}")]
    Remote(String),
    /// The user stopped it (e.g. a file transfer).
    #[error("Cancelled.")]
    Cancelled,
    #[error("Keychain: {0}")]
    Keychain(String),
    #[error("Could not read or write app data: {0}")]
    Io(#[from] std::io::Error),
    #[error("App data is malformed: {0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "notFound",
            AppError::Invalid(_) => "invalid",
            AppError::ClientMissing(_) => "clientMissing",
            AppError::Remote(_) => "remote",
            AppError::Cancelled => "cancelled",
            AppError::Keychain(_) => "keychain",
            AppError::Io(_) => "io",
            AppError::Json(_) => "json",
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keychain(e.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Io(std::io::Error::other(e.to_string()))
    }
}

pub type AppResult<T> = Result<T, AppError>;
