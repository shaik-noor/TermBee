use super::{
    events::SessionEvent,
    known_hosts::KnownHost,
    manager::{SessionCommand, SessionHandle},
    session::{self, ConnectRequest, SessionContext},
};
use crate::{
    error::{AppError, AppResult},
    state::AppState,
};
use std::sync::Arc;
use tauri::{ipc::Channel, State};
use tokio::sync::{mpsc, Notify};

/// Start a session. Returns its id at once; progress, output and the outcome all arrive
/// on `on_event`.
#[tauri::command]
pub async fn ssh_connect(
    state: State<'_, AppState>,
    request: ConnectRequest,
    on_event: Channel<SessionEvent>,
) -> AppResult<String> {
    if request.hostname.trim().is_empty() || request.username.trim().is_empty() {
        return Err(AppError::Invalid(
            "A hostname and username are required.".into(),
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::unbounded_channel();
    let cancel = Arc::new(Notify::new());
    state.sessions.insert(
        id.clone(),
        SessionHandle {
            commands: tx,
            cancel: cancel.clone(),
        },
    );

    tauri::async_runtime::spawn(session::run(SessionContext {
        id: id.clone(),
        request,
        events: on_event,
        manager: state.sessions.clone(),
        known_hosts: state.known_hosts.clone(),
        hosts: state.hosts.clone(),
        commands: rx,
        cancel,
    }));
    Ok(id)
}

fn gone() -> AppError {
    AppError::NotFound("This session has ended.".into())
}

#[tauri::command]
pub fn ssh_write(state: State<'_, AppState>, session_id: String, data: String) -> AppResult<()> {
    state
        .sessions
        .send(&session_id, SessionCommand::Write(data.into_bytes()))
        .then_some(())
        .ok_or_else(gone)
}

#[tauri::command]
pub fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state
        .sessions
        .send(&session_id, SessionCommand::Resize { cols, rows })
        .then_some(())
        .ok_or_else(gone)
}

#[tauri::command]
pub fn ssh_close(state: State<'_, AppState>, session_id: String) {
    state.sessions.close(&session_id);
}

#[tauri::command]
pub fn ssh_host_key_decision(
    state: State<'_, AppState>,
    session_id: String,
    accept: bool,
) -> AppResult<()> {
    state
        .sessions
        .answer_host_key(&session_id, accept)
        .then_some(())
        .ok_or_else(gone)
}

#[tauri::command]
pub async fn known_hosts_list(state: State<'_, AppState>) -> AppResult<Vec<KnownHost>> {
    Ok(state.known_hosts.list())
}

#[tauri::command]
pub async fn known_hosts_forget(
    state: State<'_, AppState>,
    hostname: String,
    port: u16,
) -> AppResult<()> {
    state.known_hosts.forget(&hostname, port)
}
