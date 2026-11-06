use super::{base_name, entry, join, kind_of, remote_err, walk};
use crate::{
    error::{AppError, AppResult},
    files::{pump, read_head, safe_local_name, EntryKind, FileEntry, Meter, Progress},
    local,
    state::AppState,
};
use russh_sftp::client::{error::Error as SftpError, SftpSession};
use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{
    ipc::{Channel, Response},
    State,
};

fn session(state: &AppState, id: &str) -> AppResult<Arc<SftpSession>> {
    state.sessions.sftp(id).ok_or_else(|| {
        AppError::NotFound("This file session has ended. Reconnect to keep browsing.".into())
    })
}

/// The folder a files tab starts in (the login's home directory).
#[tauri::command]
pub async fn sftp_home(state: State<'_, AppState>, session_id: String) -> AppResult<String> {
    let sftp = session(&state, &session_id)?;
    sftp.canonicalize(".")
        .await
        .map_err(|e| remote_err(e, "your home folder"))
}

/// A directory's entries, unsorted (the UI sorts). Symlinks report what they point to.
#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<Vec<FileEntry>> {
    let sftp = session(&state, &session_id)?;
    let dir = sftp
        .read_dir(&path)
        .await
        .map_err(|e| remote_err(e, &path))?;
    let mut out = Vec::new();
    for e in dir {
        let name = e.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = e.metadata();
        let full = join(&path, &name);
        let link = meta.file_type().is_symlink();
        let kind = if link {
            match sftp.metadata(&full).await {
                Ok(target) => kind_of(&target),
                Err(_) => EntryKind::Other, // dangling link
            }
        } else {
            kind_of(&meta)
        };
        out.push(entry(name, full, &meta, kind, link));
    }
    Ok(out)
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<()> {
    let sftp = session(&state, &session_id)?;
    sftp.create_dir(&path)
        .await
        .map_err(|e| remote_err(e, &path))
}

/// Renames, or moves within the server (a different folder in `to`).
#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let sftp = session(&state, &session_id)?;
    if sftp.try_exists(&to).await.unwrap_or(false) {
        return Err(AppError::Invalid(format!("{to} already exists.")));
    }
    sftp.rename(&from, &to)
        .await
        .map_err(|e| remote_err(e, &from))
}

/// Deletes a file, or a folder with everything in it.
#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    dir: bool,
) -> AppResult<()> {
    if path.trim().is_empty() || path.trim_end_matches('/').is_empty() {
        return Err(AppError::Invalid(
            "TermBee won't delete the server's root folder.".into(),
        ));
    }
    let sftp = session(&state, &session_id)?;
    let result = if dir {
        remove_tree(&sftp, &path).await
    } else {
        sftp.remove_file(&path).await
    };
    result.map_err(|e| remote_err(e, &path))
}

async fn remove_tree(sftp: &SftpSession, path: &str) -> Result<(), SftpError> {
    for entry in sftp.read_dir(path).await? {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let full = join(path, &name);
        // `file_type` doesn't follow links, so a link to a folder is removed, not recursed.
        if entry.file_type().is_dir() {
            Box::pin(remove_tree(sftp, &full)).await?;
        } else {
            sftp.remove_file(&full).await?;
        }
    }
    sftp.remove_dir(path).await
}

/// The first `max_bytes` of a file, as raw bytes (previews and the text editor).
#[tauri::command]
pub async fn sftp_read(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    max_bytes: u64,
) -> AppResult<Response> {
    let sftp = session(&state, &session_id)?;
    let mut file = sftp.open(&path).await.map_err(|e| remote_err(e, &path))?;
    let bytes = read_head(&mut file, max_bytes)
        .await
        .map_err(|e| AppError::Remote(format!("{path}: {e}")))?;
    Ok(Response::new(bytes))
}

/// Saves text back to the server, replacing the file (the editor's Save).
#[tauri::command]
pub async fn sftp_write_text(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    text: String,
) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;
    let sftp = session(&state, &session_id)?;
    let mut file = sftp.create(&path).await.map_err(|e| remote_err(e, &path))?;
    let saved = async {
        file.write_all(text.as_bytes()).await?;
        file.shutdown().await
    };
    saved
        .await
        .map_err(|e| AppError::Remote(format!("Couldn't save {path}: {e}")))
}

/// Where a download goes: a path the user picked, or a folder (the remote name is kept).
#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DownloadTarget {
    File { path: String },
    Dir { dir: String },
}

/// Downloads a file or a whole folder; returns the local path of what was saved.
#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    session_id: String,
    transfer_id: String,
    remote_path: String,
    target: DownloadTarget,
    on_progress: Channel<Progress>,
) -> AppResult<String> {
    let sftp = session(&state, &session_id)?;
    let tree = walk(&sftp, &remote_path, true).await?;
    let root = match target {
        DownloadTarget::File { path } if !tree.is_dir => PathBuf::from(path),
        DownloadTarget::File { .. } => {
            return Err(AppError::Invalid(
                "Pick a folder to download a folder into.".into(),
            ))
        }
        DownloadTarget::Dir { dir } => {
            let name = base_name(&remote_path);
            let name = safe_local_name(name).ok_or_else(|| {
                AppError::Invalid(format!(
                    "“{name}” can't be saved on this computer because of its name."
                ))
            })?;
            Path::new(&dir).join(name)
        }
    };
    let cancel = state.sessions.start_transfer(&transfer_id);
    let mut meter = Meter::new(&on_progress, &cancel, tree.bytes, tree.files.len() as u32);
    let result = async {
        if tree.is_dir {
            tokio::fs::create_dir_all(&root).await?;
            for rel in &tree.dirs {
                tokio::fs::create_dir_all(local::join_rel(&root, rel)).await?;
            }
        }
        for (remote, rel, _) in &tree.files {
            let local = if rel.is_empty() {
                root.clone()
            } else {
                local::join_rel(&root, rel)
            };
            meter.start_file(base_name(remote));
            let copied = async {
                let mut src = sftp.open(remote).await.map_err(|e| remote_err(e, remote))?;
                let mut dst = tokio::fs::File::create(&local).await?;
                pump(&mut src, &mut dst, &mut meter).await
            }
            .await;
            if copied.is_err() {
                let _ = tokio::fs::remove_file(&local).await; // no half files
            }
            copied?;
            meter.end_file();
        }
        AppResult::Ok(())
    }
    .await;
    state.sessions.end_transfer(&transfer_id);
    result?;
    meter.finish();
    Ok(root.to_string_lossy().into_owned())
}

/// Uploads a local file or folder to `remote_path` (the full destination path), replacing
/// files that are already there.
#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: String,
    transfer_id: String,
    local_path: String,
    remote_path: String,
    on_progress: Channel<Progress>,
) -> AppResult<()> {
    let sftp = session(&state, &session_id)?;
    let tree = local::walk(PathBuf::from(&local_path)).await?;
    let cancel = state.sessions.start_transfer(&transfer_id);
    let mut meter = Meter::new(&on_progress, &cancel, tree.bytes, tree.files.len() as u32);
    let result = async {
        if tree.is_dir {
            mkdir_if_missing(&sftp, &remote_path).await?;
            for rel in &tree.dirs {
                mkdir_if_missing(&sftp, &join(&remote_path, rel)).await?;
            }
        }
        for (local, rel, _) in &tree.files {
            let remote = if rel.is_empty() {
                remote_path.clone()
            } else {
                join(&remote_path, rel)
            };
            meter.start_file(base_name(&remote));
            let copied = async {
                let mut src = tokio::fs::File::open(local).await?;
                let mut dst = sftp
                    .create(&remote)
                    .await
                    .map_err(|e| remote_err(e, &remote))?;
                pump(&mut src, &mut dst, &mut meter).await
            }
            .await;
            if copied.is_err() {
                let _ = sftp.remove_file(&remote).await;
            }
            copied?;
            meter.end_file();
        }
        AppResult::Ok(())
    }
    .await;
    state.sessions.end_transfer(&transfer_id);
    result?;
    meter.finish();
    Ok(())
}

/// Copies a file or folder to `to` on the same server (SFTP has no server-side copy, so the
/// bytes stream through this computer).
#[tauri::command]
pub async fn sftp_copy(
    state: State<'_, AppState>,
    session_id: String,
    transfer_id: String,
    from: String,
    to: String,
    on_progress: Channel<Progress>,
) -> AppResult<()> {
    let sftp = session(&state, &session_id)?;
    if to == from || to.starts_with(&format!("{}/", from.trim_end_matches('/'))) {
        return Err(AppError::Invalid(
            "A folder can't be copied inside itself.".into(),
        ));
    }
    if sftp.try_exists(&to).await.unwrap_or(false) {
        return Err(AppError::Invalid(format!("{to} already exists.")));
    }
    let tree = walk(&sftp, &from, false).await?;
    let cancel = state.sessions.start_transfer(&transfer_id);
    let mut meter = Meter::new(&on_progress, &cancel, tree.bytes, tree.files.len() as u32);
    let result = async {
        if tree.is_dir {
            mkdir_if_missing(&sftp, &to).await?;
            for rel in &tree.dirs {
                mkdir_if_missing(&sftp, &join(&to, rel)).await?;
            }
        }
        for (src_path, rel, _) in &tree.files {
            let dst_path = if rel.is_empty() {
                to.clone()
            } else {
                join(&to, rel)
            };
            meter.start_file(base_name(src_path));
            let mut src = sftp
                .open(src_path)
                .await
                .map_err(|e| remote_err(e, src_path))?;
            let mut dst = sftp
                .create(&dst_path)
                .await
                .map_err(|e| remote_err(e, &dst_path))?;
            pump(&mut src, &mut dst, &mut meter).await?;
            meter.end_file();
        }
        AppResult::Ok(())
    }
    .await;
    state.sessions.end_transfer(&transfer_id);
    result?;
    meter.finish();
    Ok(())
}

async fn mkdir_if_missing(sftp: &SftpSession, path: &str) -> AppResult<()> {
    if sftp.try_exists(path).await.unwrap_or(false) {
        return Ok(());
    }
    sftp.create_dir(path).await.map_err(|e| remote_err(e, path))
}

#[tauri::command]
pub fn sftp_cancel_transfer(state: State<'_, AppState>, transfer_id: String) {
    state.sessions.cancel_transfer(&transfer_id);
}
