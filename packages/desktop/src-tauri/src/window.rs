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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::paths::DataRoot;

/// The label the editor window is built with. Everything that has to tell the
/// editor apart from the settings window compares against this, so a rename
/// can only happen in one place.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Whether `label` names the editor window, the only one whose closing stops
/// the file watcher and whose geometry is remembered.
pub fn is_editor_window(label: &str) -> bool {
    label == MAIN_WINDOW_LABEL
}


/// What `window-state.json` holds.
///
/// The size is in logical pixels, because `inner_size` takes those on the
/// builder: a physical size would come back wrong on a display whose scale
/// factor changed since the file was written.
///
/// The position is in **physical** pixels. A global logical position is
/// ambiguous across displays with different scale factors — on a 100% primary
/// and a 200% secondary, logical 1200 names two different points — and the
/// window had been landing on the wrong screen for it. Physical coordinates are
/// the ones the window system uses, so they identify a point on one display.
#[derive(Clone, Debug, Deserialize, Serialize)]
struct WindowState {
    #[serde(default)]
    width: Option<f64>,
    #[serde(default)]
    height: Option<f64>,
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    /// `0` is a file written before the position was made physical. Those
    /// numbers are converted once, on load.
    #[serde(default)]
    version: u32,
    /// Only meaningful for `version == 0`: the whole file (size and position)
    /// was written in logical pixels. The field stays in the struct so an old
    /// file still deserialises.
    #[serde(default)]
    logical: bool,
    #[serde(default)]
    maximized: bool,
    #[serde(default)]
    fullscreen: bool,
}

/// The shape this build writes.
const STATE_VERSION: u32 = 1;

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: None,
            height: None,
            x: None,
            y: None,
            version: STATE_VERSION,
            logical: false,
            maximized: false,
            fullscreen: false,
        }
    }
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
pub fn create(app: &AppHandle, data: &DataRoot) -> Result<(), Box<dyn Error>> {
    let config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or("tauri.conf.json has no window to build")?;

    let saved = load(&data.window_state()).unwrap_or_default();
    let state = normalize(app, saved);

    // WebView2 appends its own `EBWebView` segment, so the directory handed to
    // it is the data root itself — the profile lands at `<data>/EBWebView`.
    let mut builder =
        WebviewWindowBuilder::from_config(app, &config)?.data_directory(data.dir.clone());

    if let (Some(width), Some(height)) = (state.width, state.height) {
        builder = builder.inner_size(width, height);
    }

    let window = builder.build()?;

    // Place the window only where the user can still reach it: a monitor that
    // was unplugged since the last run must not strand the window off-screen
    // with no way to drag it back. The saved point is physical, so it is applied
    // as one — the builder only takes logical coordinates, which is the
    // ambiguity this file no longer has to guess at.
    if let (Some(x), Some(y)) = (state.x, state.y) {
        if is_on_a_monitor(app, x, y) {
            let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
        }
    }

    if state.fullscreen {
        let _ = window.set_fullscreen(true);
    } else if state.maximized {
        let _ = window.maximize();
    }

    // A fresh editor window means the app is in use again: a quit the user
    // cancelled must not make the next ordinary close take the settings
    // window with it.
    QUIT_REQUESTED.store(false, Ordering::SeqCst);
    // The state is managed by the first build. When the editor is rebuilt after
    // being closed — the settings window can keep the process alive — the
    // managed copy has to describe the new window instead of being replaced,
    // because `manage` panics on a second call.
    match app.try_state::<Geometry>() {
        Some(geometry) => {
            if let Ok(mut current) = geometry.0.lock() {
                *current = state;
            }
        }
        None => {
            app.manage(Geometry(Mutex::new(state)));
        }
    }
    Ok(())
}

/// Focus the editor, building it again if it was closed.
///
/// A second launch is usually answered by focusing the window that is already
/// open. That fails once the editor has been closed while the settings window
/// kept the process running: there is no window to focus, and the app looks
/// dead. Rebuilding is what startup does, so it goes through `create`.
pub fn focus_or_create_editor(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let data = app.state::<DataRoot>();
    create(app, &data)
}

/// Whether a point given in physical pixels still falls on a monitor.
///
/// The state file stores the position in physical pixels, the same unit
/// `monitor_from_point` reads, so the saved corner can be tested directly.
fn is_on_a_monitor(app: &AppHandle, x: f64, y: f64) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return false;
    };

    monitors.iter().any(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        let left = f64::from(position.x);
        let top = f64::from(position.y);
        let right = left + f64::from(size.width);
        let bottom = top + f64::from(size.height);

        x >= left && x < right && y >= top && y < bottom
    })
}

/// Remember the rectangle a free-floating window has right now. Called on
/// resize and move, and again when the app is on its way out.
pub fn track(window: &tauri::Window) {
    // Every window shares this handler, and only the editor's geometry is
    // stored.
    if !is_editor_window(window.label()) {
        return;
    }

    let app = window.app_handle();
    let (Some(geometry), Some(editor)) =
        (app.try_state::<Geometry>(), app.get_webview_window(MAIN_WINDOW_LABEL))
    else {
        return;
    };
    // A minimised window reports a rectangle that is not where the user left
    // it, and nothing about the minimised state is worth restoring.
    if editor.is_minimized().unwrap_or(false) {
        return;
    }

    let maximized = editor.is_maximized().unwrap_or(false);
    let fullscreen = editor.is_fullscreen().unwrap_or(false);

    let Ok(mut state) = geometry.0.lock() else {
        return;
    };
    // Record the flags on every resize and move, not only when the window
    // quits with one: a window closed from the menu is destroyed before the
    // exit hook runs, and the flags in the cache are then all that is left.
    // Zooming reports a resize before `is_maximized()` turns true, so this can
    // lag by one event; the next one, or `save` while the window still exists,
    // catches up.
    state.maximized = maximized;
    state.fullscreen = fullscreen;
    if maximized || fullscreen {
        return;
    }
    update_bounds(&editor, &mut state);
}

/// Remember the window for the next launch. Called on the way out, when the
/// geometry still describes what the user last saw.
///
/// Closing the window runs this while it still exists, which is where the
/// maximised/full-screen flags and the last free-floating rectangle come from.
/// Quitting from the menu destroys the windows first, so the exit hook reaches
/// this with nothing to measure: the rectangle `track` already recorded is what
/// the user last saw, and it must still reach the file.
pub fn save(app: &AppHandle) {
    let (Some(data), Some(geometry)) = (app.try_state::<DataRoot>(), app.try_state::<Geometry>())
    else {
        return;
    };

    let Ok(mut state) = geometry.0.lock() else {
        return;
    };
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        // The flags are read here even when the window cannot be measured: a
        // zoomed window is destroyed before the exit hook runs, and
        // `is_maximized` is the only place the state is still visible then.
        state.maximized = window.is_maximized().unwrap_or(state.maximized);
        state.fullscreen = window.is_fullscreen().unwrap_or(state.fullscreen);
        if !state.maximized && !state.fullscreen && !window.is_minimized().unwrap_or(false) {
            update_bounds(&window, &mut state);
        }
    }
    state.version = STATE_VERSION;
    state.logical = false;

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

/// Read the window rectangle into `state`: size in logical pixels, position in
/// physical ones.
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
        state.x = Some(f64::from(x));
        state.y = Some(f64::from(y));
    }
    state.version = STATE_VERSION;
    state.logical = false;
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

/// Bring a file written by an older build up to the current shape.
///
/// Version 0 stored size and position in one unit, named by `logical`. The
/// current file stores a logical size and a physical position, so a legacy
/// position has to be turned into physical pixels exactly once — using the
/// monitor under the saved point, which is the only scale the old file gives
/// any clue about.
fn normalize(app: &AppHandle, state: WindowState) -> WindowState {
    if state.version >= STATE_VERSION {
        return state;
    }

    // `monitor_from_point` reads physical pixels; on a legacy physical file the
    // saved point already is one, and on a logical file this is the best guess
    // the file allows.
    let scale = state
        .x
        .zip(state.y)
        .and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|monitor| monitor.scale_factor())
        .filter(|scale| *scale > 0.0)
        .unwrap_or(1.0);

    normalize_at_scale(state, scale)
}

/// Unit conversion after the platform has selected a monitor scale.
///
/// Idempotent: `normalize` rejects a current file before it gets here, and the
/// early return keeps a second conversion from rescaling coordinates that are
/// already in the right unit.
fn normalize_at_scale(mut state: WindowState, scale: f64) -> WindowState {
    if state.version >= STATE_VERSION {
        return state;
    }
    if state.logical {
        // Everything was logical: the size already is, the position is not.
        state.x = state.x.map(|value| value * scale);
        state.y = state.y.map(|value| value * scale);
    } else {
        // Everything was physical: the position already is, the size is not.
        state.width = state.width.map(|value| value / scale);
        state.height = state.height.map(|value| value / scale);
    }

    state.version = STATE_VERSION;
    state.logical = false;
    state
}

fn load(path: &std::path::Path) -> Option<WindowState> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Save the geometry while the window is still alive.
///
/// The editor closes through `destroy()` once the user agrees, which skips
/// `CloseRequested` — and with it the save that hook performs. The renderer
/// calls this first, so flags the exit hook can no longer read still reach the
/// file.
#[tauri::command]
pub fn remember_window_state(app: AppHandle) {
    save(&app);
}

/// Set while a quit is in progress, so the editor's own close can take the
/// remaining windows with it instead of leaving the settings window (and the
/// process) behind. Cleared when a new editor window is built.
static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Quit the application through the windows' close handshakes.
///
/// The app-menu Quit item cannot rely on `RunEvent::ExitRequested` (macOS turns
/// `terminate:` into `LoopDestroyed`, which only produces `RunEvent::Exit`), so
/// the quit is driven from here: the editor is asked to close, and once it is
/// gone its `Destroyed` hook closes whatever else is still open. With no editor
/// left, that means the settings window, which flushes its preferences on the
/// way out like any other close.
pub fn quit_request<R: Runtime>(app: &AppHandle<R>) {
    QUIT_REQUESTED.store(true, Ordering::SeqCst);

    match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(editor) => {
            let _ = editor.unminimize();
            let _ = editor.set_focus();
            if let Err(err) = editor.close() {
                eprintln!("[window] could not close the editor for the quit: {err}");
                QUIT_REQUESTED.store(false, Ordering::SeqCst);
            }
        }
        None => close_other_windows(app),
    }
}

/// Continue a quit that is already in progress once a window has gone.
///
/// Runs from the window event callback, so the remaining windows are closed on
/// a later main-thread tick: closing a window while another one is being
/// destroyed re-enters the event loop, and at least macOS refuses to tear down
/// two windows from the same callback.
pub fn finish_quit<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if !is_editor_window(label) || !QUIT_REQUESTED.swap(false, Ordering::SeqCst) {
        return;
    }

    let handle = app.clone();
    if let Err(err) = app.run_on_main_thread(move || close_other_windows(&handle)) {
        eprintln!("[window] could not schedule the rest of the quit: {err}");
        close_other_windows(app);
    }
}

/// Forget a quit the user abandoned in the unsaved-files dialog.
///
/// Without this the flag would survive a cancelled quit and the next ordinary
/// close of the editor would take the settings window down with it.
#[tauri::command]
pub fn cancel_quit() {
    QUIT_REQUESTED.store(false, Ordering::SeqCst);
}

fn close_other_windows<R: Runtime>(app: &AppHandle<R>) {
    for (label, window) in app.webview_windows() {
        if is_editor_window(&label) {
            continue;
        }
        if let Err(err) = window.close() {
            eprintln!("[window] could not close {label} for the quit: {err}");
        }
    }
}

/// Route an application exit through the windows' close handshakes.
///
/// Some exits — `AppHandle::exit`, and the last window going away under a
/// caller that asked for one — reach this before any close request, so the
/// renderer's `onCloseRequested` guard never runs and unsaved drafts vanish.
/// Ask the editor to close instead: that path flushes, offers to save, and
/// destroys the window once the user agrees; its `Destroyed` hook takes the
/// remaining windows with it.
///
/// Returns whether the caller must prevent the exit it is handling. Only an app
/// with no windows left at all may leave: any window still up owes a flush, so
/// the exit is held while it closes itself.
pub fn veto_exit(app: &AppHandle) -> bool {
    if let Some(editor) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        QUIT_REQUESTED.store(true, Ordering::SeqCst);
        let _ = editor.unminimize();
        let _ = editor.set_focus();
        if let Err(err) = editor.close() {
            // The editor is still up with nothing asked; holding the exit here
            // would leave the app unquittable, so forget the quit and let the
            // caller retry through the normal path.
            eprintln!("[window] could not route the exit through the editor: {err}");
            QUIT_REQUESTED.store(false, Ordering::SeqCst);
        }

        return true;
    }

    // Only auxiliary windows are left — the settings window, usually. It flushes
    // its preferences in its own close handler, so the exit waits for it.
    if app.webview_windows().is_empty() {
        return false;
    }

    let handle = app.clone();
    if let Err(err) = app.run_on_main_thread(move || close_other_windows(&handle)) {
        eprintln!("[window] could not schedule the rest of the exit: {err}");
        close_other_windows(app);
    }

    true
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
    //
    // Only while the dev server is the thing serving the page: the config keeps
    // `devUrl` in the packaged build too, and following it there would open the
    // settings window on a localhost URL that no longer exists.
    let dev_url = app
        .config()
        .build
        .dev_url
        .clone()
        .filter(|_| tauri::is_dev());
    let target = match dev_url {
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
    if let Some(editor) = app.get_webview_window(MAIN_WINDOW_LABEL) {
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

#[cfg(test)]
mod geometry_tests {
    use super::*;

    fn legacy(logical: bool) -> WindowState {
        WindowState {
            width: Some(1200.0),
            height: Some(800.0),
            x: Some(-900.0),
            y: Some(100.0),
            version: 0,
            logical,
            maximized: true,
            fullscreen: false,
        }
    }

    #[test]
    fn only_the_editor_window_counts_as_the_editor() {
        assert!(is_editor_window(MAIN_WINDOW_LABEL));
        assert!(!is_editor_window("settings"));
        assert!(!is_editor_window("editor-2"));
    }

    #[test]
    fn legacy_logical_coordinates_become_physical_on_a_scaled_display() {
        let state = normalize_at_scale(legacy(true), 1.5);
        assert_eq!((state.x, state.y), (Some(-1350.0), Some(150.0)));
        assert_eq!((state.width, state.height), (Some(1200.0), Some(800.0)));
        assert!(state.maximized);
        assert!(!state.logical);
        assert_eq!(state.version, STATE_VERSION);
    }

    #[test]
    fn legacy_physical_size_becomes_logical_without_moving_the_window() {
        let state = normalize_at_scale(legacy(false), 2.0);
        assert_eq!((state.width, state.height), (Some(600.0), Some(400.0)));
        assert_eq!((state.x, state.y), (Some(-900.0), Some(100.0)));
    }

    #[test]
    fn moving_to_another_scale_does_not_convert_current_coordinates_again() {
        let state = normalize_at_scale(normalize_at_scale(legacy(true), 1.5), 2.0);
        assert_eq!((state.x, state.y), (Some(-1350.0), Some(150.0)));
        assert_eq!(state.width, Some(1200.0));
    }

    #[test]
    fn migration_preserves_missing_coordinates_and_fullscreen_state() {
        let mut state = legacy(true);
        state.x = None;
        state.height = None;
        state.fullscreen = true;
        let state = normalize_at_scale(state, 1.25);
        assert_eq!(state.x, None);
        assert_eq!(state.height, None);
        assert_eq!(state.y, Some(125.0));
        assert!(state.fullscreen);
    }
}
