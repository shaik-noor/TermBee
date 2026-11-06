use crate::{
    error::AppResult,
    hosts::HostStore,
    ssh::{known_hosts::KnownHosts, manager::SessionManager},
};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// Everything commands share. Fields are `Arc`s so session tasks can hold them.
pub struct AppState {
    pub hosts: Arc<HostStore>,
    pub known_hosts: Arc<KnownHosts>,
    pub sessions: Arc<SessionManager>,
}

impl AppState {
    pub fn load(app: &AppHandle) -> AppResult<Self> {
        // %APPDATA%\app.termbee.desktop on Windows, ~/Library/Application Support/… on macOS.
        let dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            hosts: Arc::new(HostStore::open(
                dir.join("hosts.json"),
                dir.join("folders.json"),
            )?),
            known_hosts: Arc::new(KnownHosts::open(dir.join("known_hosts.json"))?),
            sessions: Arc::new(SessionManager::default()),
        })
    }
}
