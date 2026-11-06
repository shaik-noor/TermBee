//! TermBee core. Module map:
//! - `hosts`   saved hosts + their commands (metadata in JSON, secrets in the keychain)
//! - `ssh`     native SSH sessions, host-key trust (TOFU), streaming to the UI
//! - `sftp`    file browsing + transfers over an SSH session opened in SFTP mode
//! - `rdp`     Remote Desktop hosts, handed to the OS client (mstsc / Windows App)
//! - `local`   the "This PC" pane of a files tab (list, copy, trash, preview)
//! - `files`   entry/progress types and the copy loop both panes share
//! - `secrets` OS keychain access
//! - `store`   versioned, atomic JSON files
//! - `state`   the shared `AppState`

mod error;
mod files;
mod hosts;
mod local;
mod rdp;
mod secrets;
mod sftp;
mod ssh;
mod state;
mod store;
#[doc(hidden)]
pub mod testing;

use tauri::{Manager, RunEvent};

pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be the first plugin: a second launch just focuses the running window.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    let app = builder
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // The UI shows the window itself once it has painted (no white flash).
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let state = state::AppState::load(app.handle())?;
            app.manage(state);

            // Safety net: if the UI never calls `show()` (e.g. it failed to load), show
            // the window anyway so the app doesn't look dead.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hosts::commands::hosts_list,
            hosts::commands::hosts_save,
            hosts::commands::hosts_delete,
            hosts::commands::ssh_default_key_paths,
            hosts::commands::hosts_hive,
            hosts::commands::hosts_move,
            hosts::commands::folders_create,
            hosts::commands::folders_move,
            hosts::commands::folders_delete,
            ssh::commands::ssh_connect,
            ssh::commands::ssh_write,
            ssh::commands::ssh_resize,
            ssh::commands::ssh_close,
            ssh::commands::ssh_host_key_decision,
            ssh::commands::known_hosts_list,
            ssh::commands::known_hosts_forget,
            rdp::commands::rdp_open,
            sftp::commands::sftp_home,
            sftp::commands::sftp_list,
            sftp::commands::sftp_mkdir,
            sftp::commands::sftp_rename,
            sftp::commands::sftp_delete,
            sftp::commands::sftp_download,
            sftp::commands::sftp_upload,
            sftp::commands::sftp_read,
            sftp::commands::sftp_write_text,
            sftp::commands::sftp_copy,
            sftp::commands::sftp_cancel_transfer,
            local::local_places,
            local::local_list,
            local::local_mkdir,
            local::local_rename,
            local::local_copy,
            local::local_trash,
            local::local_read,
            local::local_open,
            local::local_reveal,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build TermBee");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { .. } = event {
            if let Some(state) = app.try_state::<state::AppState>() {
                state.sessions.close_all();
            }
        }
    });
}
