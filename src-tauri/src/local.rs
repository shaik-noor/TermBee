//! The "This PC" pane of a files tab: browsing and simple file operations on this computer.
//! Deleting goes to the Recycle Bin / Trash (never a permanent delete), and every blocking
//! filesystem call runs off the async runtime.

use crate::{
    error::{AppError, AppResult},
    files::{read_head, EntryKind, FileEntry},
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{ipc::Response, AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// A shortcut in the pane's places list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub label: String,
    pub path: String,
    /// `home` | `desktop` | `documents` | `downloads` | `drive`
    pub kind: &'static str,
}

/// Joins a `/`-separated relative path onto a local folder.
pub fn join_rel(root: &Path, rel: &str) -> PathBuf {
    rel.split('/')
        .fold(root.to_path_buf(), |p, part| p.join(part))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await?
}

fn entry(path: &Path) -> FileEntry {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let link = fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    let meta = fs::metadata(path).ok(); // follows links
    let kind = match &meta {
        Some(m) if m.is_dir() => EntryKind::Dir,
        Some(m) if m.is_file() => EntryKind::File,
        _ => EntryKind::Other,
    };
    #[cfg(windows)]
    let hidden = {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        name.starts_with('.')
            || meta
                .as_ref()
                .is_some_and(|m| m.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0)
    };
    #[cfg(not(windows))]
    let hidden = name.starts_with('.');
    #[cfg(unix)]
    let permissions = meta.as_ref().map(|m| {
        use std::os::unix::fs::PermissionsExt;
        crate::files::mode_string(m.permissions().mode())
    });
    #[cfg(not(unix))]
    let permissions = None;
    FileEntry {
        name,
        path: path.to_string_lossy().into_owned(),
        kind,
        link,
        hidden,
        size: meta
            .as_ref()
            .map_or(0, |m| if m.is_file() { m.len() } else { 0 }),
        modified: meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs().min(u32::MAX as u64) as u32),
        permissions,
    }
}

fn io_err(e: std::io::Error, path: &str) -> AppError {
    use std::io::ErrorKind::*;
    match e.kind() {
        NotFound => AppError::NotFound(format!("{path} doesn't exist.")),
        PermissionDenied => {
            AppError::Invalid(format!("You don't have permission to access {path}."))
        }
        AlreadyExists => AppError::Invalid(format!("{path} already exists.")),
        _ => AppError::Invalid(format!("{path}: {e}")),
    }
}

/// Everything under a local path, for folder uploads. `rel` paths use `/`.
pub struct LocalTree {
    pub is_dir: bool,
    pub dirs: Vec<String>,
    pub files: Vec<(PathBuf, String, u64)>, // (local path, rel path, size)
    pub bytes: u64,
}

/// Walks `root` without following folder links (no loops).
pub async fn walk(root: PathBuf) -> AppResult<LocalTree> {
    blocking(move || {
        let shown = root.to_string_lossy().into_owned();
        let meta = fs::metadata(&root).map_err(|e| io_err(e, &shown))?;
        let mut tree = LocalTree {
            is_dir: meta.is_dir(),
            dirs: Vec::new(),
            files: Vec::new(),
            bytes: 0,
        };
        if !tree.is_dir {
            tree.bytes = meta.len();
            tree.files.push((root, String::new(), meta.len()));
            return Ok(tree);
        }
        let mut stack = vec![(root, String::new())];
        while let Some((dir, rel)) = stack.pop() {
            let shown = dir.to_string_lossy().into_owned();
            for e in fs::read_dir(&dir).map_err(|e| io_err(e, &shown))? {
                let e = e.map_err(|e| io_err(e, &shown))?;
                let name = e.file_name().to_string_lossy().into_owned();
                let child = if rel.is_empty() {
                    name
                } else {
                    format!("{rel}/{name}")
                };
                let ft = e.file_type().map_err(|e| io_err(e, &shown))?;
                if ft.is_dir() {
                    tree.dirs.push(child.clone());
                    stack.push((e.path(), child));
                } else if let Ok(m) = fs::metadata(e.path()) {
                    if m.is_file() {
                        tree.bytes += m.len();
                        tree.files.push((e.path(), child, m.len()));
                    }
                }
            }
        }
        Ok(tree)
    })
    .await
}

/// Home, the usual folders, and every drive (Windows) or volume (macOS).
#[tauri::command]
pub async fn local_places(app: AppHandle) -> AppResult<Vec<Place>> {
    let p = app.path();
    let mut out = Vec::new();
    for (label, kind, dir) in [
        ("Home", "home", p.home_dir()),
        ("Desktop", "desktop", p.desktop_dir()),
        ("Documents", "documents", p.document_dir()),
        ("Downloads", "downloads", p.download_dir()),
    ] {
        if let Ok(dir) = dir {
            if dir.is_dir() {
                out.push(Place {
                    label: label.into(),
                    path: dir.to_string_lossy().into_owned(),
                    kind,
                });
            }
        }
    }
    #[cfg(windows)]
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if Path::new(&root).exists() {
            out.push(Place {
                label: format!("{}:", letter as char),
                path: root,
                kind: "drive",
            });
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(volumes) = fs::read_dir("/Volumes") {
        for v in volumes.flatten() {
            out.push(Place {
                label: v.file_name().to_string_lossy().into_owned(),
                path: v.path().to_string_lossy().into_owned(),
                kind: "drive",
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn local_list(path: String) -> AppResult<Vec<FileEntry>> {
    blocking(move || {
        let rd = fs::read_dir(&path).map_err(|e| io_err(e, &path))?;
        Ok(rd.flatten().map(|e| entry(&e.path())).collect())
    })
    .await
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> AppResult<()> {
    blocking(move || fs::create_dir(&path).map_err(|e| io_err(e, &path))).await
}

/// Renames, or moves within this computer.
#[tauri::command]
pub async fn local_rename(from: String, to: String) -> AppResult<()> {
    blocking(move || {
        if Path::new(&to).exists() {
            return Err(AppError::Invalid(format!("{to} already exists.")));
        }
        fs::rename(&from, &to).map_err(|e| io_err(e, &from))
    })
    .await
}

/// Copies a file or folder (with everything inside) to `to`.
#[tauri::command]
pub async fn local_copy(from: String, to: String) -> AppResult<()> {
    blocking(move || {
        let (src, dst) = (PathBuf::from(&from), PathBuf::from(&to));
        if dst.exists() {
            return Err(AppError::Invalid(format!("{to} already exists.")));
        }
        if dst.starts_with(&src) {
            return Err(AppError::Invalid(
                "A folder can't be copied inside itself.".into(),
            ));
        }
        copy_tree(&src, &dst).map_err(|e| io_err(e, &from))
    })
    .await
}

fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    if fs::symlink_metadata(src)?.is_dir() {
        fs::create_dir(dst)?;
        for e in fs::read_dir(src)? {
            let e = e?;
            copy_tree(&e.path(), &dst.join(e.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(src, dst).map(|_| ())
    }
}

/// Moves files and folders to the Recycle Bin (Windows) or Trash (macOS).
#[tauri::command]
pub async fn local_trash(paths: Vec<String>) -> AppResult<()> {
    blocking(move || {
        trash::delete_all(&paths)
            .map_err(|e| AppError::Invalid(format!("Couldn't move to the trash: {e}")))
    })
    .await
}

/// The first `max_bytes` of a local file, as raw bytes (previews).
#[tauri::command]
pub async fn local_read(path: String, max_bytes: u64) -> AppResult<Response> {
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| io_err(e, &path))?;
    let bytes = read_head(&mut file, max_bytes)
        .await
        .map_err(|e| io_err(e, &path))?;
    Ok(Response::new(bytes))
}

/// Opens a local file with its default app.
#[tauri::command]
pub async fn local_open(app: AppHandle, path: String) -> AppResult<()> {
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| AppError::Invalid(format!("Couldn't open {path}: {e}")))
}

/// Shows a local file selected in Explorer / Finder.
#[tauri::command]
pub async fn local_reveal(app: AppHandle, path: String) -> AppResult<()> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| AppError::Invalid(format!("Couldn't show {path}: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("termbee-local-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("a/b")).unwrap();
        fs::write(dir.join("a/one.txt"), "1").unwrap();
        fs::write(dir.join("a/b/two.txt"), "22").unwrap();
        dir
    }

    #[test]
    fn copies_trees_and_refuses_overwrites() {
        let dir = temp();
        copy_tree(&dir.join("a"), &dir.join("c")).unwrap();
        assert_eq!(fs::read_to_string(dir.join("c/b/two.txt")).unwrap(), "22");
        assert!(join_rel(&dir, "c/b/two.txt").is_file());
    }

    #[tokio::test]
    async fn walks_folders_for_upload() {
        let dir = temp();
        let tree = walk(dir.join("a")).await.unwrap();
        assert!(tree.is_dir);
        assert_eq!(tree.dirs, ["b"]);
        assert_eq!(tree.bytes, 3);
        let mut rels: Vec<_> = tree.files.iter().map(|f| f.1.as_str()).collect();
        rels.sort();
        assert_eq!(rels, ["b/two.txt", "one.txt"]);
    }
}
