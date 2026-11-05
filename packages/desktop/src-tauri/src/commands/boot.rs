// `mt::boot-info` — the one-shot startup handshake the renderer reads to learn
// its platform, key paths and capabilities. In the Electron build this was a
// synchronous `ipcRenderer.sendSync`; under Tauri the bridge shim awaits this
// command once before mounting Vue.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootPaths {
    resources: String,
    user_data: String,
    cwd: String,
    ripgrep_binary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    // Node-style values so existing renderer checks (`platform === 'darwin'`)
    // keep working without change.
    platform: String,
    arch: String,
    versions: HashMap<String, String>,
    env: HashMap<String, String>,
    paths: BootPaths,
    is_updatable: bool,
    #[serde(rename = "MARKDOWN_INCLUSIONS")]
    markdown_inclusions: Vec<String>,
    /// Paths to open after the renderer has installed its listeners.
    initial_paths: Vec<String>,
    /// OS UI language resolved to an available locale (e.g. "zh-CN"), so the
    /// renderer loads the matching translations.
    locale: String,
}

/// Files a second launch named, waiting for an editor that can open them.
///
/// A window existing is not the same as its renderer listening: right after the
/// editor is rebuilt the native window is up while `mt::open-new-tab` has no
/// listener yet, and Tauri does not replay an event to a listener registered
/// afterwards. Requests therefore wait here and the renderer pulls them with
/// `take_pending_open_files` once it has registered — which also makes a burst
/// of double-clicks end with every document open instead of only the first.
fn pending_open() -> &'static Mutex<Vec<String>> {
    static PENDING_OPEN: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    PENDING_OPEN.get_or_init(|| Mutex::new(Vec::new()))
}

/// Queue the files another launch named. The renderer is told they are there,
/// but the queue is the record: the event is only a nudge.
pub fn queue_open_files(paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut pending) = pending_open().lock() {
        for path in paths {
            if !pending.contains(&path) {
                pending.push(path);
            }
        }
    }
}

/// Hand the queued files to the caller and clear them. Draining rather than
/// peeking keeps a burst idempotent: whoever pulls gets each path exactly once.
#[tauri::command]
pub fn take_pending_open_files() -> Vec<String> {
    pending_open()
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

/// Scan the process arguments for a readable file to open on launch (CLI use:
/// `folira path/to/file.md`, and Windows/Linux file associations, which
/// also pass the path as an argument).
fn initial_paths_from_args() -> Vec<String> {
    // This launch's own argv is relative to this process's directory, which is
    // the shell's: resolving here keeps one shape of path on both launch paths.
    let cwd = std::env::current_dir().ok();
    paths_from_args(std::env::args().skip(1), cwd.as_deref())
}

/// The argument scan itself, over an arbitrary argument list.
///
/// A second launch is funnelled into the running instance rather than starting
/// a new process, so the single-instance handler runs this over *that*
/// process's argv (already stripped of argv[0]). Its relative arguments belong
/// to *its* working directory: `folira note.md` typed in another folder must
/// open that folder's `note.md`, not the one beside the running instance, so
/// the caller passes the directory to resolve against. Paths come back absolute
/// for the same reason — the renderer cannot know where the request came from.
pub fn paths_from_args(
    args: impl Iterator<Item = String>,
    cwd: Option<&std::path::Path>,
) -> Vec<String> {
    args.filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            let path = std::path::Path::new(&arg);
            let resolved = match cwd {
                Some(dir) if path.is_relative() => dir.join(path),
                _ => path.to_path_buf(),
            };
            resolved
                .is_file()
                .then(|| resolved.to_string_lossy().into_owned())
        })
        .collect()
}

const MARKDOWN_EXTENSIONS: [&str; 11] = [
    "markdown", "mdown", "mkdn", "md", "mkd", "mdwn", "mdtxt", "mdtext", "mdx", "text", "txt",
];

fn node_platform() -> String {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
    .to_string()
}

fn node_arch() -> String {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
    .to_string()
}

/// Return the bundled translation JSON for `lang` so the renderer's i18n can
/// load non-English locales (the Electron path went through main via IPC).
#[tauri::command]
pub fn load_locale(app: tauri::AppHandle, lang: String) -> Option<serde_json::Value> {
    let path = app
        .path()
        .resource_dir()
        .ok()?
        .join("locales")
        .join(format!("{lang}.json"));
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

#[tauri::command]
pub fn boot_info(app: tauri::AppHandle) -> Result<BootInfo, String> {
    // The renderer's first call into the shell: everything before this is
    // process spawn, plugin setup and WebView creation.
    crate::startup::trace("boot_info: entered");

    let resolver = app.path();

    let resources = resolver
        .resource_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    // The renderer writes preferences and its data centre under this path, so
    // it follows the data root rather than the platform's per-user directory.
    let user_data = app
        .try_state::<crate::paths::DataRoot>()
        .map(|root| root.dir.to_string_lossy().into_owned())
        .or_else(|| {
            resolver
                .app_data_dir()
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        })
        .unwrap_or_default();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut versions = HashMap::new();
    versions.insert("tauri".to_string(), env!("CARGO_PKG_VERSION").to_string());

    Ok(BootInfo {
        platform: node_platform(),
        arch: node_arch(),
        versions,
        // The renderer only reads a handful of env vars; forward the full set
        // for parity and let callers pick what they need.
        env: std::env::vars().collect(),
        paths: BootPaths {
            resources,
            user_data,
            cwd,
            // Wired in phase 6 when ripgrep search moves to a sidecar/crate.
            ripgrep_binary: String::new(),
        },
        // Auto-update lands in phase 7 (tauri-plugin-updater).
        is_updatable: false,
        markdown_inclusions: MARKDOWN_EXTENSIONS.iter().map(|s| s.to_string()).collect(),
        initial_paths: {
            // Defer file reads until the renderer has mounted so a large startup
            // document cannot block the first usable frame.
            let paths = initial_paths_from_args();
            crate::startup::trace("boot_info: initial paths collected");
            paths
        },
        locale: crate::menu::i18n::resolve_locale().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("folira-boot-{label}-{}", std::process::id()))
    }

    struct Caller {
        dir: PathBuf,
    }

    impl Caller {
        fn new(label: &str) -> Self {
            let dir = temp_path(label);
            fs::create_dir_all(&dir).unwrap();
            Caller { dir }
        }

        fn file(&self, name: &str) -> PathBuf {
            let path = self.dir.join(name);
            fs::write(&path, b"# Doc\n").unwrap();
            path
        }
    }

    impl Drop for Caller {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn resolves_a_relative_argument_against_the_directory_it_was_typed_in() {
        let launching = Caller::new("caller");
        let running = Caller::new("running");
        let target = launching.file("note.md");
        running.file("note.md");

        // The second process ran in `launching`, the process answering ran in
        // `running`: the argument names the caller's file, not a namesake.
        let files = paths_from_args(
            vec!["note.md".to_string()].into_iter(),
            Some(&launching.dir),
        );
        assert_eq!(files, vec![target.to_string_lossy().into_owned()]);

        let wrong = paths_from_args(vec!["note.md".to_string()].into_iter(), Some(&running.dir));
        assert_ne!(wrong, files);
    }

    #[test]
    fn hands_out_queued_files_once() {
        queue_open_files(vec![
            "a.md".to_string(),
            "b.md".to_string(),
            "a.md".to_string(),
        ]);
        queue_open_files(vec!["b.md".to_string(), "c.md".to_string()]);

        let first = take_pending_open_files();
        assert_eq!(first, vec!["a.md", "b.md", "c.md"]);
        assert!(take_pending_open_files().is_empty());
    }
}
