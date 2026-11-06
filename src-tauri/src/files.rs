//! Types and plumbing shared by both panes of a files tab: the local computer (`local`) and
//! the server (`sftp`). One entry shape, one progress shape, one copy loop.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::ipc::Channel;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const CHUNK: usize = 256 * 1024;
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    File,
    Dir,
    Other,
}

/// One row of a directory listing, local or remote.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    /// Full path in the pane's own convention (`/` remote, `\` on Windows locally).
    pub path: String,
    /// For a symlink, the kind of what it points to.
    pub kind: EntryKind,
    pub link: bool,
    /// Dotfiles, and on Windows files with the hidden attribute.
    pub hidden: bool,
    pub size: u64,
    /// Unix seconds.
    pub modified: Option<u32>,
    /// `drwxr-xr-x` style, where the platform has it.
    pub permissions: Option<String>,
}

/// Streamed to the UI while a transfer runs (at most every 100 ms).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: u64,
    pub total: u64,
    pub files_done: u32,
    pub files_total: u32,
    /// The file being moved right now (folder transfers).
    pub current: Option<String>,
}

/// Counts bytes and files for one transfer, reports progress and honors cancel.
pub struct Meter<'a> {
    channel: &'a Channel<Progress>,
    cancel: &'a AtomicBool,
    p: Progress,
    last: Instant,
}

impl<'a> Meter<'a> {
    pub fn new(
        channel: &'a Channel<Progress>,
        cancel: &'a AtomicBool,
        total: u64,
        files: u32,
    ) -> Self {
        Self {
            channel,
            cancel,
            p: Progress {
                done: 0,
                total,
                files_done: 0,
                files_total: files,
                current: None,
            },
            last: Instant::now() - PROGRESS_EVERY,
        }
    }

    pub fn check(&self) -> AppResult<()> {
        if self.cancel.load(Ordering::SeqCst) {
            Err(AppError::Cancelled)
        } else {
            Ok(())
        }
    }

    pub fn start_file(&mut self, name: &str) {
        self.p.current = Some(name.to_string());
        self.send(true);
    }

    pub fn end_file(&mut self) {
        self.p.files_done += 1;
        self.send(false);
    }

    fn add(&mut self, n: u64) {
        self.p.done += n;
        self.send(false);
    }

    fn send(&mut self, force: bool) {
        if force || self.last.elapsed() >= PROGRESS_EVERY {
            self.last = Instant::now();
            let _ = self.channel.send(self.p.clone());
        }
    }

    /// Final report: always sent, and `total` never reads lower than `done`.
    pub fn finish(mut self) {
        self.p.total = self.p.total.max(self.p.done);
        self.p.current = None;
        let _ = self.channel.send(self.p);
    }
}

/// Copies `src` to `dst` in large chunks, metering every chunk.
pub async fn pump<R, W>(src: &mut R, dst: &mut W, meter: &mut Meter<'_>) -> AppResult<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let stopped = |e: std::io::Error| AppError::Remote(format!("The transfer stopped: {e}"));
    let mut buf = vec![0u8; CHUNK];
    loop {
        meter.check()?;
        let n = src.read(&mut buf).await.map_err(stopped)?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await.map_err(stopped)?;
        meter.add(n as u64);
    }
    dst.shutdown().await.map_err(stopped)?;
    Ok(())
}

/// Reads at most `max` bytes from the start of `src` (previews never load a huge file).
pub async fn read_head<R: AsyncRead + Unpin>(src: &mut R, max: u64) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    src.take(max).read_to_end(&mut out).await?;
    Ok(out)
}

/// A file or folder name that is safe to create on this computer: no path separators, no
/// `..`, nothing Windows refuses. Guards downloads against a hostile server.
pub fn safe_local_name(name: &str) -> Option<&str> {
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0']);
    (!bad).then_some(name)
}

/// `ls -l` style permissions, e.g. `drwxr-xr-x`.
pub fn mode_string(mode: u32) -> String {
    let mut s = String::with_capacity(10);
    s.push(match mode & 0o170000 {
        0o040000 => 'd',
        0o120000 => 'l',
        _ => '-',
    });
    for shift in [6, 3, 0] {
        let bits = (mode >> shift) & 7;
        s.push(if bits & 4 != 0 { 'r' } else { '-' });
        s.push(if bits & 2 != 0 { 'w' } else { '-' });
        s.push(if bits & 1 != 0 { 'x' } else { '-' });
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_render_like_ls() {
        assert_eq!(mode_string(0o040755), "drwxr-xr-x");
        assert_eq!(mode_string(0o100644), "-rw-r--r--");
        assert_eq!(mode_string(0o120777), "lrwxrwxrwx");
    }

    #[test]
    fn hostile_names_are_rejected() {
        assert_eq!(safe_local_name("notes.txt"), Some("notes.txt"));
        for bad in ["", ".", "..", "../x", "a/b", "a\\b", "C:x", "con?"] {
            assert_eq!(safe_local_name(bad), None, "{bad}");
        }
    }
}
