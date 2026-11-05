//! The editor window: its geometry, and where WebView2 keeps its profile.
//!
//! Two things have to happen here rather than in `tauri.conf.json`.
//!
//! WebView2 defaults to a profile under `%LOCALAPPDATA%`, which a green install
//! must not create, so the window is built with an explicit `data_directory`
//! under the app's own data root. Tauri only takes that path through the
//! builder, hence `create: false` in the config and a window built by hand.
//!
//! Geometry is stored next to the rest of the data for the same reason: the
//! window-state plugin writes into the per-user config directory, which this
//! build is trying not to use.

use std::error::Error;

use serde::{Deserialize, Serialize};
use tauri::{
    App, AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

use crate::paths::DataRoot;

/// What `window-state.json` holds. Every field is optional so a truncated or
/// older file still restores the parts that survived.
#[derive(Debug, Default, Deserialize, Serialize)]
struct WindowState {
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    x: Option<i32>,
    #[serde(default)]
    y: Option<i32>,
    #[serde(default)]
    maximized: bool,
}

/// Build the main window.
///
/// The config entry carries the size, minimums, background colour and the
/// frameless decorations; everything added here is what the config cannot
/// express: the WebView2 data directory and the geometry from the last run.
pub fn create(app: &App, data: &DataRoot) -> Result<(), Box<dyn Error>> {
    let config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or("tauri.conf.json has no window to build")?;

    let saved = load(&data.window_state());
    // WebView2 appends its own `EBWebView` segment, so the directory handed to
    // it is the data root itself — the profile lands at `<data>/EBWebView`.
    let mut builder =
        WebviewWindowBuilder::from_config(app.handle(), &config)?.data_directory(data.dir.clone());

    if let Some(state) = &saved {
        if let (Some(width), Some(height)) = (state.width, state.height) {
            builder = builder.inner_size(f64::from(width), f64::from(height));
        }
        // Place the window only where the user can still reach it: a monitor
        // that was unplugged since the last run must not strand the window
        // off-screen with no way to drag it back.
        if let (Some(x), Some(y)) = (state.x, state.y) {
            if app
                .monitor_from_point(f64::from(x), f64::from(y))?
                .is_some()
            {
                builder = builder.position(f64::from(x), f64::from(y));
            }
        }
    }

    let window = builder.build()?;
    if saved.as_ref().is_some_and(|state| state.maximized) {
        let _ = window.maximize();
    }
    Ok(())
}

/// Remember the window for the next launch. Called on the way out, when the
/// geometry still describes what the user last saw.
pub fn save(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(data) = app.try_state::<DataRoot>() else {
        return;
    };

    let maximized = window.is_maximized().unwrap_or(false);
    let mut state = load(&data.window_state()).unwrap_or_default();
    state.maximized = maximized;

    // While maximized, `inner_size`/`outer_position` describe the maximized
    // frame; the pre-maximize rectangle is what a later unmaximize should
    // restore, so leave the saved numbers alone.
    if !maximized {
        if let Ok(PhysicalSize { width, height }) = window.inner_size() {
            state.width = Some(width);
            state.height = Some(height);
        }
        if let Ok(PhysicalPosition { x, y }) = window.outer_position() {
            state.x = Some(x);
            state.y = Some(y);
        }
    }

    let path = data.window_state();
    match serde_json::to_vec_pretty(&state) {
        Ok(bytes) => {
            if let Err(err) = std::fs::write(&path, bytes) {
                eprintln!("[window] could not save {}: {err}", path.display());
            }
        }
        Err(err) => eprintln!("[window] could not encode window state: {err}"),
    }
}

fn load(path: &std::path::Path) -> Option<WindowState> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Open the preferences window, or focus it if it is already up.
///
/// It is built here rather than from the renderer so it gets the same WebView2
/// `data_directory` as the editor. A window created without one falls back to
/// `%LOCALAPPDATA%`, which a green install must not create — and which fails
/// with "access denied" once an earlier run created that profile under another
/// integrity level.
///
/// `async` matters: a synchronous command runs on the main thread, and building
/// a webview blocks until the main thread pumps the creation message, which it
/// cannot do while it is running this command.
#[tauri::command]
pub async fn open_settings_window(app: AppHandle, url: String) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        return existing.set_focus().map_err(|error| error.to_string());
    }

    // `WebviewUrl::App` resolves against the custom protocol, which the dev
    // server never sees; with `devUrl` configured the path has to be joined
    // onto it instead, exactly as Tauri does for the windows in the config.
    let target = match app.config().build.dev_url.clone() {
        Some(dev_url) => {
            WebviewUrl::External(dev_url.join(&url).map_err(|error| error.to_string())?)
        }
        None => WebviewUrl::App(url.into()),
    };

    let data = app.state::<DataRoot>();
    WebviewWindowBuilder::new(&app, "settings", target)
        .title("Folira")
        .inner_size(950.0, 650.0)
        .min_inner_size(800.0, 500.0)
        .decorations(false)
        .data_directory(data.dir.clone())
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}
