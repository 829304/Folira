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
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    App, AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::paths::DataRoot;

/// What `window-state.json` holds.
///
/// Geometry is in logical pixels, the unit both `inner_size` and `position`
/// take on the builder. Physical pixels would restore a different size on a
/// display whose scale factor has changed since the file was written.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct WindowState {
    #[serde(default)]
    width: Option<f64>,
    #[serde(default)]
    height: Option<f64>,
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    /// `false` marks a file written before the unit was fixed: those numbers
    /// are physical pixels and have to be divided by the monitor's scale.
    #[serde(default)]
    logical: bool,
    #[serde(default)]
    maximized: bool,
    #[serde(default)]
    fullscreen: bool,
}

/// Geometry as the app currently sees it.
///
/// The file is only written on the way out, but a window can be quit while it
/// is maximized or full-screen — states in which the reported rectangle is the
/// screen rather than the size the user chose. Recording every free-floating
/// resize keeps the rectangle to restore current.
pub struct Geometry(Mutex<WindowState>);

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

    let saved = load(&data.window_state()).unwrap_or_default();
    let state = if saved.logical {
        saved
    } else {
        from_physical(app, saved)
    };

    // WebView2 appends its own `EBWebView` segment, so the directory handed to
    // it is the data root itself — the profile lands at `<data>/EBWebView`.
    let mut builder =
        WebviewWindowBuilder::from_config(app.handle(), &config)?.data_directory(data.dir.clone());

    if let (Some(width), Some(height)) = (state.width, state.height) {
        builder = builder.inner_size(width, height);
    }
    // Place the window only where the user can still reach it: a monitor that
    // was unplugged since the last run must not strand the window off-screen
    // with no way to drag it back.
    if let (Some(x), Some(y)) = (state.x, state.y) {
        if is_on_a_monitor(app, x, y) {
            builder = builder.position(x, y);
        }
    }

    let window = builder.build()?;
    if state.fullscreen {
        let _ = window.set_fullscreen(true);
    } else if state.maximized {
        let _ = window.maximize();
    }

    app.manage(Geometry(Mutex::new(state)));
    Ok(())
}

/// Whether a point given in logical pixels still falls on a monitor.
///
/// `monitor_from_point` reads physical pixels, and the state file stores
/// logical ones, so feeding the saved point to it would misjudge the corner on
/// a scaled display. Converting each monitor into its own logical space avoids
/// the question of which scale applies before a monitor has been picked.
fn is_on_a_monitor(app: &App, x: f64, y: f64) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return false;
    };

    monitors.iter().any(|monitor| {
        let scale = monitor.scale_factor();
        if scale <= 0.0 {
            return false;
        }
        let position = monitor.position();
        let size = monitor.size();
        let left = f64::from(position.x) / scale;
        let top = f64::from(position.y) / scale;
        let right = left + f64::from(size.width) / scale;
        let bottom = top + f64::from(size.height) / scale;

        x >= left && x < right && y >= top && y < bottom
    })
}

/// Remember the rectangle a free-floating window has right now. Called on
/// resize and move, and again when the app is on its way out.
pub fn track(window: &tauri::Window) {
    // Every window shares this handler, and only the editor's geometry is
    // stored.
    if window.label() != "main" {
        return;
    }

    let app = window.app_handle();
    let (Some(geometry), Some(editor)) =
        (app.try_state::<Geometry>(), app.get_webview_window("main"))
    else {
        return;
    };
    if editor.is_maximized().unwrap_or(false) || editor.is_fullscreen().unwrap_or(false) {
        return;
    }

    let Ok(mut state) = geometry.0.lock() else {
        return;
    };
    update_bounds(&editor, &mut state);
}

/// Remember the window for the next launch. Called on the way out, when the
/// geometry still describes what the user last saw.
pub fn save(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (Some(data), Some(geometry)) = (app.try_state::<DataRoot>(), app.try_state::<Geometry>())
    else {
        return;
    };

    let Ok(mut state) = geometry.0.lock() else {
        return;
    };
    state.maximized = window.is_maximized().unwrap_or(false);
    state.fullscreen = window.is_fullscreen().unwrap_or(false);
    if !state.maximized && !state.fullscreen {
        update_bounds(&window, &mut state);
    }
    state.logical = true;

    let path = data.window_state();
    match serde_json::to_vec_pretty(&*state) {
        Ok(bytes) => {
            if let Err(err) = std::fs::write(&path, bytes) {
                eprintln!("[window] could not save {}: {err}", path.display());
            }
        }
        Err(err) => eprintln!("[window] could not encode window state: {err}"),
    }
}

/// Read the window rectangle into `state`, in logical pixels.
fn update_bounds(window: &WebviewWindow, state: &mut WindowState) {
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    if scale <= 0.0 {
        return;
    }

    if let Ok(PhysicalSize { width, height }) = window.inner_size() {
        // Zooming reports a resize before `is_maximized()` turns true, so the
        // maximized rectangle would replace the free-floating one we want to
        // come back to. A rectangle as large as the screen is that resize.
        if fills_screen(window, PhysicalSize::new(width, height)) {
            return;
        }
        state.width = Some(f64::from(width) / scale);
        state.height = Some(f64::from(height) / scale);
    }
    if let Ok(PhysicalPosition { x, y }) = window.outer_position() {
        state.x = Some(f64::from(x) / scale);
        state.y = Some(f64::from(y) / scale);
    }
    state.logical = true;
}

/// Whether `size` is as large as the screen the window sits on.
///
/// A zoomed window fills the work area and a fullscreen one fills the whole
/// monitor; both are rectangles the user never chose, so they must not become
/// the geometry restored on the next launch.
fn fills_screen(window: &WebviewWindow, size: PhysicalSize<u32>) -> bool {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return false;
    };
    let area = monitor.work_area().size;
    let full = monitor.size();

    (size.width >= area.width && size.height >= area.height)
        || (size.width >= full.width && size.height >= full.height)
}

/// Convert a file written in physical pixels to the logical ones it is now
/// read as. The monitor under the saved corner supplies the scale; a window
/// whose corner is gone falls back to the primary monitor's.
fn from_physical(app: &App, state: WindowState) -> WindowState {
    let scale = state
        .x
        .zip(state.y)
        .and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    if scale <= 0.0 {
        return state;
    }

    WindowState {
        width: state.width.map(|value| value / scale),
        height: state.height.map(|value| value / scale),
        x: state.x.map(|value| value / scale),
        y: state.y.map(|value| value / scale),
        logical: true,
        ..state
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
    let window = WebviewWindowBuilder::new(&app, "settings", target)
        .title("Folira")
        .inner_size(950.0, 650.0)
        .min_inner_size(800.0, 500.0)
        .decorations(false)
        .data_directory(data.dir.clone())
        .build()
        .map_err(|error| error.to_string())?;

    // Centring is cosmetic: a window placed by the OS default is still usable,
    // so a failure here must not report the settings page as unopenable.
    if let Some(editor) = app.get_webview_window("main") {
        let _ = center_over(&app, &editor, &window);
    }

    Ok(())
}

/// Places `child` in the middle of `parent`, then pulls it back onto the
/// monitor if that centre would hang part of it off the screen.
///
/// Left alone, the OS cascades a new window off the last one it placed, which
/// put the preferences window over a corner of the editor regardless of where
/// the editor was. The editor is what the user is looking at, so it is the
/// reference point and the child stays on the same monitor.
fn center_over(
    app: &AppHandle,
    parent: &WebviewWindow,
    child: &WebviewWindow,
) -> tauri::Result<()> {
    let origin = parent.outer_position()?;
    let parent_size = parent.outer_size()?;
    let child_size = child.outer_size()?;

    let mut x = origin.x + (parent_size.width as i32 - child_size.width as i32) / 2;
    let mut y = origin.y + (parent_size.height as i32 - child_size.height as i32) / 2;

    // The preferences window is most of the editor's size, so centring it over
    // an editor near the edge of a work area (or a small display) can put its
    // title bar outside the part the user can reach.
    let centre_x = f64::from(origin.x + parent_size.width as i32 / 2);
    let centre_y = f64::from(origin.y + parent_size.height as i32 / 2);
    if let Some(monitor) = app.monitor_from_point(centre_x, centre_y)? {
        let area = monitor.work_area();
        let left = area.position.x;
        let top = area.position.y;
        let right = left + area.size.width as i32 - child_size.width as i32;
        let bottom = top + area.size.height as i32 - child_size.height as i32;
        x = x.clamp(left, right.max(left));
        y = y.clamp(top, bottom.max(top));
    }

    child.set_position(PhysicalPosition::new(x, y))
}
