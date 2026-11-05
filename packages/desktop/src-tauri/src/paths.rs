//! Where Folira keeps its own data.
//!
//! A green install keeps everything beside the executable: `data/` next to
//! `folira.exe` holds preferences, the WebView2 profile, the startup log and the
//! window state. The per-user directory is a fallback for the case the portable
//! layout cannot serve — an install under `C:\Program Files`, or a read-only
//! medium — because writing there fails for a normal user.
//!
//! The choice is made once per process and written to the startup log, so a bug
//! report says which layout was in use.

use std::path::{Path, PathBuf};

/// How the data root was chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    /// `FOLIRA_DATA_DIR` or `--data-dir`: the caller decided where data goes.
    Explicit,
    /// A writable directory holding the executable (`<exe>/data`).
    Portable,
    /// The install location is not writable, so the per-user one is used.
    Fallback,
}

impl Origin {
    pub fn label(self) -> &'static str {
        match self {
            Origin::Explicit => "explicit",
            Origin::Portable => "portable",
            Origin::Fallback => "fallback",
        }
    }
}

/// The directory the app writes to, and why it was picked.
#[derive(Clone, Debug)]
pub struct DataRoot {
    pub dir: PathBuf,
    pub origin: Origin,
}

impl DataRoot {
    pub fn logs(&self) -> PathBuf {
        self.dir.join("logs")
    }

    pub fn preferences(&self) -> PathBuf {
        self.dir.join("preferences.json")
    }

    pub fn window_state(&self) -> PathBuf {
        self.dir.join("window-state.json")
    }
}

/// Resolve the data root.
///
/// Order: a directory the caller asked for, then `<exe>/data` when it is
/// writable, then whatever the platform reports for this user (`fallback`).
pub fn resolve(fallback: impl FnOnce() -> Option<PathBuf>) -> DataRoot {
    if let Some(dir) = requested_dir() {
        if ensure_writable(&dir) {
            return DataRoot {
                dir,
                origin: Origin::Explicit,
            };
        }
        eprintln!(
            "[paths] requested data directory {} is not writable",
            dir.display()
        );
    }

    if let Some(dir) = portable_dir() {
        return DataRoot {
            dir,
            origin: Origin::Portable,
        };
    }

    let dir = fallback().unwrap_or_else(|| PathBuf::from("."));
    let _ = ensure_writable(&dir);
    DataRoot {
        dir,
        origin: Origin::Fallback,
    }
}

/// A directory named by the environment or by the command line.
fn requested_dir() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("FOLIRA_DATA_DIR") {
        if !value.is_empty() {
            return Some(PathBuf::from(value));
        }
    }

    // Scan the process arguments rather than the ones the shell forwarded: a
    // second launch through the file association passes only a file name, and a
    // relative `--data-dir` has to be resolved against the working directory
    // the launcher chose.
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--data-dir" {
            return args
                .next()
                .filter(|value| !value.is_empty())
                .map(PathBuf::from);
        }
        if let Some(value) = arg.strip_prefix("--data-dir=") {
            if !value.is_empty() {
                return Some(PathBuf::from(value));
            }
        }
    }

    None
}

/// `<exe>/data`, when the executable's own directory accepts writes.
///
/// A macOS `.app` is a directory the Finder presents as one file, and the
/// executable lives at `Folira.app/Contents/MacOS/folira`. Writing next to it
/// would put preferences and a WebView profile inside the bundle: an update
/// replaces that tree, the signature no longer matches, and the next launch
/// starts from scratch. Bundles therefore fall through to the per-user
/// directory instead.
fn portable_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    if inside_app_bundle(&exe) {
        return None;
    }
    let dir = exe.parent()?.join("data");
    ensure_writable(&dir).then_some(dir)
}

/// Whether any ancestor of `path` is a macOS `.app` bundle.
fn inside_app_bundle(path: &Path) -> bool {
    path.ancestors()
        .any(|part| part.extension().is_some_and(|ext| ext == "app"))
}

/// Create `dir` if needed and prove it accepts a file, so a read-only install
/// directory is detected here instead of on the first failed save.
pub fn ensure_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Carry a file from the per-user directory into the data root, once.
///
/// A copy, not a move: the previous install keeps working, and removing this
/// build does not take the user's preferences with it.
pub fn migrate_legacy_file(legacy: Option<PathBuf>, target: &Path) {
    let Some(source) = legacy else {
        return;
    };
    if target.exists() || !source.is_file() {
        return;
    }
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(err) = std::fs::copy(&source, target) {
        eprintln!("[paths] could not carry over {}: {err}", source.display());
    }
}

/// Convert the window state written by `tauri-plugin-window-state` into the
/// file this build reads, once.
///
/// That plugin stores a map keyed by window label; this build stores the main
/// window's rectangle flat. Without the conversion the first launch after the
/// move would forget where the user left the window.
pub fn migrate_legacy_window_state(legacy: Option<PathBuf>, target: &Path) {
    let Some(source) = legacy else {
        return;
    };
    if target.exists() || !source.is_file() {
        return;
    }
    let Ok(text) = std::fs::read_to_string(&source) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let Some(main) = value.get("main") else {
        return;
    };

    let mut state = serde_json::Map::new();
    for key in ["width", "height", "x", "y"] {
        if let Some(number) = main.get(key) {
            state.insert(key.to_string(), number.clone());
        }
    }
    state.insert(
        "maximized".to_string(),
        main.get("maximized")
            .cloned()
            .unwrap_or(serde_json::Value::Bool(false)),
    );

    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_vec_pretty(&serde_json::Value::Object(state)) {
        Ok(bytes) => {
            if let Err(err) = std::fs::write(target, bytes) {
                eprintln!("[paths] could not carry over {}: {err}", source.display());
            }
        }
        Err(_) => {}
    }
}
