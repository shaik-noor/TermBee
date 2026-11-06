//! Test-only harness that drives a real session without a window: events are captured
//! as JSON strings and host keys are auto-trusted. Used by `tests/ssh_live.rs`.
#![doc(hidden)]

pub use crate::hosts::AuthMethod;
pub use crate::ssh::session::{run as run_session, ConnectRequest, SessionContext, SessionMode};

use crate::{
    error::AppResult,
    hosts::HostStore,
    ssh::{
        known_hosts::KnownHosts,
        manager::{SessionCommand, SessionHandle, SessionManager},
    },
};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::{mpsc, Notify};

pub struct SessionTestRig {
    id: String,
    events: Arc<Mutex<Vec<String>>>,
    manager: Arc<SessionManager>,
    known_hosts: Arc<KnownHosts>,
    hosts: Arc<HostStore>,
    channel: Channel<crate::ssh::events::SessionEvent>,
}

impl SessionTestRig {
    pub fn new(dir: &Path, output: Arc<Mutex<String>>) -> AppResult<Self> {
        std::fs::create_dir_all(dir)?;
        let id = uuid::Uuid::new_v4().to_string();
        let events = Arc::new(Mutex::new(Vec::new()));
        let manager = Arc::new(SessionManager::default());
        let channel = {
            let (events, manager, id) = (events.clone(), manager.clone(), id.clone());
            Channel::new(move |body| {
                if let InvokeResponseBody::Json(json) = body {
                    let v: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
                    match v["type"].as_str() {
                        Some("hostKey") => {
                            manager.answer_host_key(&id, true);
                        }
                        Some("data") => output
                            .lock()
                            .unwrap()
                            .push_str(v["data"].as_str().unwrap_or_default()),
                        _ => {}
                    }
                    if v["type"] != "data" {
                        eprintln!("event: {json}");
                    }
                    events.lock().unwrap().push(json);
                }
                Ok(())
            })
        };
        Ok(Self {
            id,
            events,
            manager,
            known_hosts: Arc::new(KnownHosts::open(dir.join("known_hosts.json"))?),
            hosts: Arc::new(HostStore::open(
                dir.join("hosts.json"),
                dir.join("folders.json"),
            )?),
            channel,
        })
    }

    pub fn context(&self, request: ConnectRequest) -> SessionContext {
        let (tx, rx) = mpsc::unbounded_channel();
        let cancel = Arc::new(Notify::new());
        self.manager.insert(
            self.id.clone(),
            SessionHandle {
                commands: tx,
                cancel: cancel.clone(),
            },
        );
        SessionContext {
            id: self.id.clone(),
            request,
            events: self.channel.clone(),
            manager: self.manager.clone(),
            known_hosts: self.known_hosts.clone(),
            hosts: self.hosts.clone(),
            commands: rx,
            cancel,
        }
    }

    pub fn write(&self, text: &str) {
        self.manager
            .send(&self.id, SessionCommand::Write(text.as_bytes().to_vec()));
    }

    pub fn close(&self) {
        self.manager.close(&self.id);
    }

    pub fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }

    pub async fn wait_for(&self, pred: impl Fn(&[String]) -> bool, timeout: Duration) -> bool {
        self.wait_until(|| pred(&self.events.lock().unwrap()), timeout)
            .await
    }

    pub async fn wait_until(&self, cond: impl Fn() -> bool, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        while tokio::time::Instant::now() < deadline {
            if cond() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        cond()
    }
}
