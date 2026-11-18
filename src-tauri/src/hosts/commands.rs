use super::{Hive, Host, HostInput};
use crate::{error::AppResult, state::AppState};
use tauri::{Manager, State};

// Commands are `async` so keychain + disk work runs off the main (UI) thread.

#[tauri::command]
pub async fn hosts_list(state: State<'_, AppState>) -> AppResult<Vec<Host>> {
    Ok(state.hosts.list())
}

#[tauri::command]
pub async fn hosts_save(state: State<'_, AppState>, input: HostInput) -> AppResult<Host> {
    state.hosts.save(input)
}

#[tauri::command]
pub async fn hosts_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.hosts.delete(&id)
}

/// Private keys that exist in the user's `~/.ssh`, to pre-fill the key picker.
#[tauri::command]
pub async fn ssh_default_key_paths(app: tauri::AppHandle) -> AppResult<Vec<String>> {
    let home = app.path().home_dir()?;
    let dir = home.join(".ssh");
    Ok(["id_ed25519", "id_ecdsa", "id_rsa"]
        .iter()
        .map(|name| dir.join(name))
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

/// Hosts plus every folder path, for the sidebar tree.
#[tauri::command]
pub async fn hosts_hive(state: State<'_, AppState>) -> AppResult<Hive> {
    Ok(state.hosts.hive())
}

/// Moves hosts into a folder (`None` = top level), before `before` or at the end.
#[tauri::command]
pub async fn hosts_move(
    state: State<'_, AppState>,
    ids: Vec<String>,
    folder: Option<String>,
    before: Option<String>,
) -> AppResult<Hive> {
    state
        .hosts
        .move_hosts(&ids, folder.as_deref(), before.as_deref())
}

#[tauri::command]
pub async fn folders_create(state: State<'_, AppState>, path: String) -> AppResult<Hive> {
    state.hosts.create_folder(&path)
}

/// Renames or moves a folder with everything inside it.
#[tauri::command]
pub async fn folders_move(state: State<'_, AppState>, from: String, to: String) -> AppResult<Hive> {
    state.hosts.move_folder(&from, &to)
}

/// Deletes a folder; its hosts and subfolders move up a level.
#[tauri::command]
pub async fn folders_delete(state: State<'_, AppState>, path: String) -> AppResult<Hive> {
    state.hosts.delete_folder(&path)
}

/// Exports hosts, folders, trusted host keys, and optional keychain secrets to an `.xml` file.
#[tauri::command]
pub async fn hosts_export_xml(
    state: State<'_, AppState>,
    path: String,
    include_secrets: bool,
) -> AppResult<super::xml::ExportResult> {
    super::xml::export_xml(
        &state.hosts,
        &state.known_hosts,
        std::path::Path::new(&path),
        include_secrets,
    )
}

/// Parses an `.xml` export file and previews new hosts vs. conflicts against existing hosts.
#[tauri::command]
pub async fn hosts_import_preview(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<super::xml::ImportPreview> {
    super::xml::import_preview(&state.hosts, std::path::Path::new(&path))
}

/// Applies an `.xml` import using the user's conflict resolutions (`skip`, `replace`, `keepBoth`).
#[tauri::command]
pub async fn hosts_import_apply(
    state: State<'_, AppState>,
    path: String,
    resolutions: std::collections::HashMap<String, super::xml::ConflictResolution>,
) -> AppResult<super::xml::ImportResult> {
    super::xml::import_apply(
        &state.hosts,
        &state.known_hosts,
        std::path::Path::new(&path),
        &resolutions,
    )
}
