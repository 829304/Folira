// Tauri entry point. Registers the plugin set and the command surface that the
// renderer's bridge shim (src/renderer/src/tauri-bridge) invokes in place of the
// old Electron preload → ipcMain path.

mod commands;
mod menu;
mod paths;
mod startup;
mod window;

use tauri::{Emitter, Manager};

/// A second launch (CLI, file association, dock/taskbar) must not start another
/// process: opening several documents means several tabs in the one window.
/// Focus the existing window and hand it whatever file the new argv named,
/// through the same `mt::open-new-tab` channel the menu's Open File uses.
fn handle_second_instance(app: &tauri::AppHandle, argv: Vec<String>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    for file in commands::boot::file_from_args(argv.into_iter().skip(1)) {
        if let Err(err) = app.emit("mt::open-new-tab", serde_json::json!([file, null, true])) {
            eprintln!("[single-instance] failed to emit mt::open-new-tab: {err}");
        }
    }
}

pub fn run() {
    startup::begin();

    tauri::Builder::default()
        // Must be registered first — plugins run in registration order and this
        // one decides whether the process survives at all.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_second_instance(app, argv);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        // Registered last, so its setup runs once every other plugin is
        // initialised. That splits the stretch before the app's own `setup`:
        // process spawn and plugin init up to here, window and WebView
        // creation after it. The first trace put 1.2 s in that range without
        // saying which half, and on Windows the second half is WebView2
        // starting, which is not ours to speed up.
        .plugin(
            // The config type has to be named: a plugin with no configuration
            // gives the compiler nothing to infer `C` from (E0283).
            tauri::plugin::Builder::new("startup-probe")
                .setup(|_app, _api: tauri::plugin::PluginApi<_, ()>| {
                    startup::trace("plugins ready");
                    Ok(())
                })
                .build(),
        )
        .setup(|app| {
            // Resolve where this install keeps its data before anything writes
            // a file: portable installs use `<exe>/data`, and the log itself
            // lives there so the choice is visible in the first bug report.
            let handle = app.handle().clone();
            let data = paths::resolve(|| handle.path().app_data_dir().ok());
            startup::attach(data.logs());
            startup::trace(&format!(
                "data root: {} ({})",
                data.dir.display(),
                data.origin.label()
            ));

            // A pre-green install kept its preferences in the per-user
            // directory. Copy them across once — the original stays in place,
            // so a downgrade still finds them.
            paths::migrate_legacy_file(
                handle.path().app_data_dir().ok().map(|dir| dir.join("preferences.json")),
                &data.preferences(),
            );
            paths::migrate_legacy_window_state(
                handle
                    .path()
                    .app_config_dir()
                    .ok()
                    .map(|dir| dir.join(".window-state.json")),
                &data.window_state(),
            );

            window::create(app, &data)?;
            startup::trace("window created");
            app.manage(data);

            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;
            startup::trace("menu built");

            Ok(())
        })
        .on_window_event(|window, event| {
            // Save while the window still exists: `RunEvent::Exit` fires after
            // the window is gone, which would leave nothing to measure.
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window::save(&window.app_handle().clone());
            }
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            startup::startup_trace,
            startup::startup_log_path,
            // The preferences window shares the editor's WebView2 data directory,
            // so it has to be built on this side.
            window::open_settings_window,
            // fs::* — mirror of the mt::fs:: channels
            commands::fs::is_file,
            commands::fs::is_directory,
            commands::fs::path_exists,
            commands::fs::is_executable,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::output_file,
            commands::fs::ensure_dir,
            commands::fs::empty_dir,
            commands::fs::copy_path,
            commands::fs::move_path,
            commands::fs::unlink,
            commands::fs::trash_item,
            commands::fs::readdir,
            commands::fs::readdir_kinds,
            commands::fs::stat,
            // Loading a markdown document: encoding detection, BOM stripping
            // and line-ending normalisation, which `read_file` does not do.
            commands::markdown::read_markdown_file,
            // project tree
            commands::project::scan_project,
            // project-wide search (replaces the bundled ripgrep binary)
            commands::search::rg_start,
            commands::search::rg_cancel,
            // filesystem watching for the sidebar tree
            commands::watcher::watch_project,
            commands::watcher::unwatch_project,
            commands::watcher::watch_open_files,
            // paths::*
            commands::paths::is_image,
            commands::paths::is_same_path,
            // cmd::*
            commands::cmd::command_exists,
            commands::cmd::pandoc_to_markdown,
            // boot
            commands::boot::boot_info,
            commands::boot::load_locale,
            // custom top menu bar (frameless Windows/Linux)
            menu::dispatch_menu,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Folira")
        .run(|app, event| {
            // Written once, on the way out, while the window still reports the
            // geometry the user last saw.
            if matches!(event, tauri::RunEvent::Exit) {
                window::save(app);
            }
        });
}
