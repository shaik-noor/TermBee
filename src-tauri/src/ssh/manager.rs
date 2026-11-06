//! Registry of live sessions. Each session runs in its own task; the manager only holds
//! the handles the UI needs to talk to it (input, resize, close, host-key answer), and for
//! files tabs the live `SftpSession` plus cancel flags for running transfers.

use russh_sftp::client::SftpSession;
use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc, Mutex},
};
use tokio::sync::{mpsc, oneshot, Notify};

pub enum SessionCommand {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
}

pub struct SessionHandle {
    pub commands: mpsc::UnboundedSender<SessionCommand>,
    /// Fired by `close`; works during the handshake as well as in the shell loop.
    pub cancel: Arc<Notify>,
}

#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, SessionHandle>>,
    host_key_answers: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    sftp: Mutex<HashMap<String, Arc<SftpSession>>>,
    transfers: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl SessionManager {
    pub fn insert(&self, id: String, handle: SessionHandle) {
        self.sessions.lock().unwrap().insert(id, handle);
    }

    pub fn remove(&self, id: &str) {
        self.sessions.lock().unwrap().remove(id);
        self.host_key_answers.lock().unwrap().remove(id);
        self.sftp.lock().unwrap().remove(id);
    }

    /// Returns false when the session is already gone.
    pub fn send(&self, id: &str, cmd: SessionCommand) -> bool {
        match self.sessions.lock().unwrap().get(id) {
            Some(h) => h.commands.send(cmd).is_ok(),
            None => false,
        }
    }

    pub fn close(&self, id: &str) {
        if let Some(h) = self.sessions.lock().unwrap().get(id) {
            h.cancel.notify_one();
        }
        // Unblock a pending host-key prompt so the handshake can unwind.
        if let Some(tx) = self.host_key_answers.lock().unwrap().remove(id) {
            let _ = tx.send(false);
        }
    }

    pub fn close_all(&self) {
        let ids: Vec<String> = self.sessions.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.close(&id);
        }
    }

    pub fn await_host_key(&self, id: &str) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        self.host_key_answers
            .lock()
            .unwrap()
            .insert(id.to_string(), tx);
        rx
    }

    pub fn answer_host_key(&self, id: &str, accept: bool) -> bool {
        match self.host_key_answers.lock().unwrap().remove(id) {
            Some(tx) => tx.send(accept).is_ok(),
            None => false,
        }
    }
}

impl SessionManager {
    pub fn insert_sftp(&self, id: &str, sftp: Arc<SftpSession>) {
        self.sftp.lock().unwrap().insert(id.to_string(), sftp);
    }

    pub fn sftp(&self, id: &str) -> Option<Arc<SftpSession>> {
        self.sftp.lock().unwrap().get(id).cloned()
    }

    /// Registers a transfer and returns the flag `cancel_transfer` sets.
    pub fn start_transfer(&self, transfer_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.transfers
            .lock()
            .unwrap()
            .insert(transfer_id.to_string(), flag.clone());
        flag
    }

    pub fn end_transfer(&self, transfer_id: &str) {
        self.transfers.lock().unwrap().remove(transfer_id);
    }

    pub fn cancel_transfer(&self, transfer_id: &str) {
        if let Some(flag) = self.transfers.lock().unwrap().get(transfer_id) {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
}
