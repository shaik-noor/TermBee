use crate::{
    error::{AppError, AppResult},
    hosts::Protocol,
    state::AppState,
};
use tauri::State;

/// Opens a saved Remote Desktop host in the OS's RDP client. Returns once the client has
/// been started; the session itself lives in that app's window.
#[tauri::command]
pub async fn rdp_open(state: State<'_, AppState>, host_id: String) -> AppResult<()> {
    let host = state.hosts.get(&host_id)?;
    if host.protocol != Protocol::Rdp {
        return Err(AppError::Invalid(
            "That host isn't set up for Remote Desktop.".into(),
        ));
    }

    #[cfg(windows)]
    if host.saved_secrets.password {
        use crate::secrets::{self, SecretKind};
        match secrets::get(&host.id, SecretKind::Password)? {
            Some(password) => secrets::set_rdp_login(&host.hostname, &host.username, &password)?,
            // Cleared outside TermBee: mstsc will just ask for it.
            None => state
                .hosts
                .forget_secret_flag(&host.id, SecretKind::Password),
        }
    }

    let file = super::write_rdp_file(&host)?;
    tauri::async_runtime::spawn_blocking(move || super::launch(&file)).await??;
    state.hosts.record_login(&host.id, None)
}
