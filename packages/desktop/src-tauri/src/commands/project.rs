// `scan_project` — one call that walks an opened folder and returns everything
// the sidebar tree needs.
//
// The Electron build got this incrementally from a chokidar watcher, which also
// preloaded every markdown file's *content* into each tree event (see the HACK
// in src/main/filesystem/watcher.ts). The tree drops that content immediately,
// so this returns metadata only — the difference decides how fast a large
// project opens.
//
// One command rather than `readdir` + a `stat` per entry: a project with a few
// thousand files would otherwise cost a few thousand IPC round trips.

use serde::Serialize;
use std::path::Path;

use super::glob::{self, Exclusion};
use std::time::UNIX_EPOCH;

const MARKDOWN_EXTENSIONS: [&str; 11] = [
    "markdown", "mdown", "mkdn", "md", "mkd", "mdwn", "mdtxt", "mdtext", "mdx", "text", "txt",
];

/// Directories never worth walking.
///
/// The watcher consults the same predicate rather than repeating the list: if
/// the two ever disagreed, the watcher would add back entries the scan skipped,
/// and the tree would fill with things the user never saw it list.
///
/// `node_modules` and `.asar` mirror the Electron watcher's `ignored`
/// predicate. `.git` is the one addition: it cannot hold a user's documents,
/// and since dot-entries are otherwise shown — upstream shows them, and a
/// `.github` folder of markdown is a real thing — it would otherwise sit in
/// every repository's sidebar as an empty folder.
pub fn is_skipped_dir(name: &str) -> bool {
    name == "node_modules" || name == ".git" || name.ends_with(".asar")
}

fn is_markdown(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            MARKDOWN_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pathname: String,
    name: String,
    is_file: bool,
    is_directory: bool,
    is_markdown: bool,
    /// Epoch ms. The tree sorts on these, so both are always present.
    birth_time: f64,
    mtime_ms: f64,
}

/// How deep to walk. Deep enough for any real project, shallow enough that a
/// stray symlink into `/` cannot hang the scan.
const MAX_DEPTH: usize = 12;

fn walk(dir: &Path, depth: usize, exclusions: &[Exclusion], out: &mut Vec<ProjectEntry>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        // Unreadable directory (permissions, race with a delete) — skip it
        // rather than failing the whole scan.
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let path = entry.path();
        if glob::is_excluded(&path, exclusions) {
            continue;
        }
        let is_directory = meta.is_dir();
        if is_directory && is_skipped_dir(&name) {
            continue;
        }
        // Non-markdown files never appear in the tree.
        if !is_directory && !is_markdown(&name) {
            continue;
        }

        let epoch_ms = |time: std::io::Result<std::time::SystemTime>| -> f64 {
            time.ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0)
        };

        out.push(ProjectEntry {
            pathname: path.to_string_lossy().into_owned(),
            name,
            is_file: !is_directory,
            is_directory,
            is_markdown: !is_directory,
            birth_time: epoch_ms(meta.created()),
            mtime_ms: epoch_ms(meta.modified()),
        });

        if is_directory {
            walk(&path, depth + 1, exclusions, out);
        }
    }
}

#[tauri::command]
pub fn scan_project(path: String, exclusions: Vec<String>) -> Result<Vec<ProjectEntry>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    let mut entries = Vec::new();
    walk(root, 0, &glob::compile(&exclusions), &mut entries);
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_is_recognised_by_extension_whatever_the_case() {
        assert!(is_markdown("notes.md"));
        assert!(is_markdown("NOTES.MD"));
        assert!(is_markdown("readme.markdown"));
        assert!(is_markdown("log.txt"));
        assert!(!is_markdown("image.png"));
        // No extension at all is not markdown, however suggestive the name.
        assert!(!is_markdown("markdown"));
    }

    #[test]
    fn build_output_and_git_internals_are_skipped() {
        assert!(is_skipped_dir("node_modules"));
        assert!(is_skipped_dir(".git"));
        assert!(is_skipped_dir("app.asar"));
        assert!(!is_skipped_dir("src"));
        // Dot-directories are otherwise shown, as upstream shows them: a
        // `.github` folder of markdown is a real thing.
        assert!(!is_skipped_dir(".github"));
        assert!(!is_skipped_dir(".vitepress"));
    }

    #[test]
    fn scanning_a_real_tree_preserves_parent_order_and_excludes_ignored_subtrees() {
        let root = std::env::temp_dir().join(format!("folira-project-tree-{}", std::process::id()));
        for folder in ["notes", "node_modules", ".git", "drafts", ".github"] {
            let path = root.join(folder);
            std::fs::create_dir_all(&path).unwrap();
            std::fs::write(path.join("中文.MD"), b"# document").unwrap();
        }
        std::fs::write(root.join("notes").join("picture.png"), b"image").unwrap();

        let result = scan_project(
            root.to_string_lossy().into_owned(),
            vec!["drafts".to_string()],
        );
        let _ = std::fs::remove_dir_all(&root);
        let entries = result.unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries.iter().filter(|entry| entry.is_directory).count(), 2);
        for (index, entry) in entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| entry.is_directory)
        {
            assert!(matches!(entry.name.as_str(), "notes" | ".github"));
            assert!(!entry.is_markdown);
            let child = &entries[index + 1];
            assert_eq!(child.name, "中文.MD");
            assert!(child.is_file && child.is_markdown);
            assert!(Path::new(&child.pathname).starts_with(&entry.pathname));
        }
    }

    #[test]
    fn missing_project_root_is_reported_to_the_caller() {
        let root =
            std::env::temp_dir().join(format!("folira-project-missing-{}", std::process::id()));
        let error = scan_project(root.to_string_lossy().into_owned(), Vec::new());
        assert!(matches!(error, Err(message) if message.contains("Not a directory")));
    }
}
