//! The server side of a files tab. The connection itself (host key, login, keychain secrets)
//! is a normal SSH session opened in `SessionMode::Sftp`; these commands borrow its
//! `SftpSession` from the `SessionManager` by session id.

pub mod commands;

use crate::{
    error::{AppError, AppResult},
    files::{mode_string, safe_local_name, EntryKind, FileEntry},
};
use russh_sftp::{
    client::{error::Error as SftpError, fs::Metadata, SftpSession},
    protocol::{FileType, StatusCode},
};

pub fn kind_of(meta: &Metadata) -> EntryKind {
    match meta.file_type() {
        FileType::Dir => EntryKind::Dir,
        FileType::File => EntryKind::File,
        _ => EntryKind::Other,
    }
}

/// Joins a POSIX directory and a name (SFTP paths always use `/`).
pub fn join(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

pub fn base_name(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
}

pub fn entry(
    name: String,
    path: String,
    meta: &Metadata,
    kind: EntryKind,
    link: bool,
) -> FileEntry {
    FileEntry {
        hidden: name.starts_with('.'),
        name,
        path,
        kind,
        link,
        size: meta.size.unwrap_or(0),
        modified: meta.mtime,
        permissions: meta.permissions.map(mode_string),
    }
}

/// Turns an SFTP error into a message for people.
pub fn remote_err(e: SftpError, path: &str) -> AppError {
    match &e {
        SftpError::Status(s) => match s.status_code {
            StatusCode::NoSuchFile => AppError::NotFound(format!("{path} doesn't exist.")),
            StatusCode::PermissionDenied => {
                AppError::Remote(format!("You don't have permission to access {path}."))
            }
            _ if !s.error_message.is_empty() => {
                AppError::Remote(format!("{path}: {}", s.error_message))
            }
            _ => AppError::Remote(format!("{path}: {e}")),
        },
        SftpError::Timeout => AppError::Remote(format!("The server took too long on {path}.")),
        _ => AppError::Remote(format!("{path}: {e}")),
    }
}

/// Everything under a remote path, for folder transfers. `rel` paths use `/`.
pub struct RemoteTree {
    pub is_dir: bool,
    pub dirs: Vec<String>,
    pub files: Vec<(String, String, u64)>, // (remote path, rel path, size)
    pub bytes: u64,
}

/// Walks `root` without following folder links (no loops). With `local_safe`, every name
/// must also be valid on this computer, so a download can't escape its folder.
pub async fn walk(sftp: &SftpSession, root: &str, local_safe: bool) -> AppResult<RemoteTree> {
    let meta = sftp.metadata(root).await.map_err(|e| remote_err(e, root))?;
    let mut tree = RemoteTree {
        is_dir: meta.file_type().is_dir(),
        dirs: Vec::new(),
        files: Vec::new(),
        bytes: 0,
    };
    if !tree.is_dir {
        tree.bytes = meta.size.unwrap_or(0);
        tree.files
            .push((root.to_string(), String::new(), tree.bytes));
        return Ok(tree);
    }
    let mut stack = vec![(root.to_string(), String::new())];
    while let Some((dir, rel)) = stack.pop() {
        for e in sftp.read_dir(&dir).await.map_err(|e| remote_err(e, &dir))? {
            let name = e.file_name();
            if name == "." || name == ".." {
                continue;
            }
            if local_safe && safe_local_name(&name).is_none() {
                return Err(AppError::Invalid(format!(
                    "“{name}” in {dir} can't be saved on this computer because of its name."
                )));
            }
            let path = join(&dir, &name);
            let child = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            let meta = e.metadata();
            if meta.file_type().is_dir() {
                tree.dirs.push(child.clone());
                stack.push((path, child));
            } else {
                let size = meta.size.unwrap_or(0);
                tree.bytes += size;
                tree.files.push((path, child, size));
            }
        }
    }
    Ok(tree)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posix_paths() {
        assert_eq!(join("/", "etc"), "/etc");
        assert_eq!(join("/home/bee", "a.txt"), "/home/bee/a.txt");
        assert_eq!(base_name("/home/bee/logs/"), "logs");
        assert_eq!(base_name("/a.txt"), "a.txt");
    }
}
