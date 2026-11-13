pub mod commands;
pub mod path_utils;
pub mod pdf_export;
pub mod session_store;

pub use path_utils::{
    canonicalize_path, enqueue_pending_paths, filter_and_normalize_paths,
    is_supported_file_extension, strip_text_extensions, OpenFileResponse, PendingOpenFiles,
    SUPPORTED_FILE_EXTENSIONS,
};

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let cold_start_args: Vec<String> = std::env::args().collect();
    let initial_paths = filter_and_normalize_paths(cold_start_args, &cwd);

    let mut initial_queue = Vec::new();
    enqueue_pending_paths(&mut initial_queue, initial_paths);
    let pending_open_files = PendingOpenFiles(Mutex::new(initial_queue));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let cwd_path = PathBuf::from(&cwd);
            let new_paths = filter_and_normalize_paths(argv, &cwd_path);

            if !new_paths.is_empty() {
                if let Some(state) = app.try_state::<PendingOpenFiles>() {
                    let mut queue = state.0.lock().unwrap_or_else(|e| e.into_inner());
                    enqueue_pending_paths(&mut queue, new_paths);
                }
            }

            // Restore window state before emitting wake-up signal so webview resumes from suspension
            if let Some(window) = app
                .get_webview_window("main")
                .or_else(|| app.webview_windows().values().next().cloned())
            {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = window.emit("open-files", ());
            } else {
                let _ = app.emit("open-files", ());
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(pending_open_files)
        .invoke_handler(tauri::generate_handler![
            commands::read_text_file,
            commands::read_binary_file,
            commands::get_file_mtime,
            commands::write_text_file,
            commands::write_binary_file,
            commands::open_file_dialog,
            commands::save_file_dialog,
            commands::export_file_dialog,
            commands::export_pdf_from_html,
            commands::open_url,
            commands::open_windows_default_apps_settings,
            commands::drain_pending_open_files,
            commands::show_in_folder,
            commands::set_window_theme,
            commands::read_session_data,
            commands::write_session_data,
            commands::clear_session_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
