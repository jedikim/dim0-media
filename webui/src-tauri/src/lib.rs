use std::sync::Mutex;

use tauri::Manager;

mod oauth;
mod shell;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default().plugin(tauri_plugin_http::init());

  // macOS: unlock WKWebView's 60fps rAF cap so the canvas runs at the display's
  // native refresh (120Hz ProMotion). No-op on macOS 26+ (cap already gone).
  #[cfg(target_os = "macos")]
  let builder = builder.plugin(tauri_plugin_macos_fps::init());

  builder
    .setup(|app| {
      // Open the local SQLite database in the app-data dir and hold the single
      // connection in state. The webui drives the schema via `sql_execute`.
      let dir = app.path().app_data_dir().expect("resolve app data dir");
      std::fs::create_dir_all(&dir).expect("create app data dir");
      let conn = storage::open(&dir.join("dim0.db")).expect("open dim0.db");
      app.manage(storage::Db(Mutex::new(conn)));

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      storage::sql_execute,
      storage::sql_select,
      storage::sql_tx,
      oauth::google_oauth,
      shell::open_external
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
