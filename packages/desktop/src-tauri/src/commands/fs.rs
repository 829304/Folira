// Filesystem commands — Rust re-implementation of the `mt::fs::*` IPC channels
// that the Electron main process used to serve from Node's `fs-extra`.
//
// Signatures mirror `fileUtils.*` in the old preload bridge so the renderer's
// call sites stay unchanged. Errors are surfaced as `Result<_, String>`; the
// bridge shim rejects the corresponding Promise with that message.

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Result of `read_file`. Text encodings deserialize to a JS string; when no
/// (or a binary) encoding is requested the renderer receives a byte array it
/// wraps in a `Uint8Array`, matching the old `string | Uint8Array` return.
#[derive(Serialize)]
#[serde(untagged)]
pub enum FileData {
    Text(String),
    Binary(Vec<u8>),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedStat {
    size: f64,
    mtime_ms: f64,
    is_file: bool,
    is_directory: bool,
    is_symbolic_link: bool,
}

#[tauri::command]
pub fn is_file(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
pub fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn is_executable(path: String) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(&path)
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        // On Windows executability is by extension; treat existence as enough
        // for the callers that probe for tools like pandoc.
        Path::new(&path).is_file()
    }
}

#[tauri::command]
pub fn read_file(path: String, encoding: Option<String>) -> Result<FileData, String> {
    match encoding.as_deref() {
        // The renderer passes 'utf8' / 'utf-8' for markdown; anything else
        // (or nothing) is treated as raw bytes.
        Some("utf8") | Some("utf-8") => {
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            // Drop a byte-order mark. Every caller here wants text, and none of
            // them wants U+FEFF in front of it: `JSON.parse` rejects it outright
            // on the preferences file, and it is invisible everywhere else,
            // which is worse. Markdown documents go through
            // `commands::markdown` instead, which also handles the encodings
            // this branch cannot decode at all.
            let bytes = bytes
                .strip_prefix(&[0xefu8, 0xbb, 0xbf][..])
                .unwrap_or(&bytes);
            std::str::from_utf8(bytes)
                .map(|text| FileData::Text(text.to_owned()))
                .map_err(|e| e.to_string())
        }
        _ => fs::read(&path)
            .map(FileData::Binary)
            .map_err(|e| e.to_string()),
    }
}

/// Both of these go through `atomic_write`, which also creates missing parent
/// directories — so `output_file`'s one distinguishing behaviour is now what
/// every write does, and the two are kept apart only because the renderer's
/// `fileUtils` still has both names.
#[tauri::command]
pub fn write_file(path: String, data: FileWriteData) -> Result<(), String> {
    super::atomic_write::write_atomic(Path::new(&path), &data.into_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn output_file(path: String, data: FileWriteData) -> Result<(), String> {
    super::atomic_write::write_atomic(Path::new(&path), &data.into_bytes())
        .map_err(|e| e.to_string())
}

/// Merge `patch` into the JSON object stored at `path`, creating the file if it
/// is missing.
///
/// Each window keeps its own bag of stored preferences and used to write that
/// whole bag back, so whichever window wrote last replaced everything the other
/// one had changed since its own read. Merging on disk makes concurrent writers
/// add keys instead of overwriting each other.
#[tauri::command]
pub fn merge_json_file(path: String, patch: serde_json::Value) -> Result<(), String> {
    let path = Path::new(&path);
    let existing = match fs::read_to_string(path) {
        // A UTF-8 BOM is legal text and illegal JSON, and editors that write a
        // BOM are common on Windows. Treating such a file as unreadable would
        // drop every key it held, which is exactly what the merge is for.
        Ok(text) => serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}'))
            .ok()
            .and_then(|value| match value {
                serde_json::Value::Object(map) => Some(map),
                _ => None,
            })
            .unwrap_or_default(),
        // Anything unreadable is replaced rather than reported: the caller is
        // writing a full patch, so losing a corrupt file is the repair.
        Err(_) => serde_json::Map::new(),
    };

    let serde_json::Value::Object(patch) = patch else {
        return Err("the preference patch must be a JSON object".to_owned());
    };

    let mut merged = existing;
    merged.extend(patch);
    let value = serde_json::Value::Object(merged);
    let mut bytes = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    super::atomic_write::write_atomic(path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn empty_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        for entry in fs::read_dir(p).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let child = entry.path();
            if child.is_dir() {
                fs::remove_dir_all(&child).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&child).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    } else {
        fs::create_dir_all(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn copy_path(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&dest).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, &dest).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_path(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&dest).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // `rename` fails across filesystems; fall back to copy + remove.
    match fs::rename(&src, &dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(&src, &dest).map_err(|e| e.to_string())?;
            fs::remove_file(&src).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub fn unlink(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Move a file or directory to the OS trash — the recoverable delete the
/// sidebar's context menu offers, and the counterpart of Electron's
/// `shell.trashItem`. Distinct from `unlink`, which deletes outright.
#[tauri::command]
pub fn trash_item(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct DirEntryKind {
    file: String,
    /// `directory`, `image`, or empty for anything else.
    #[serde(rename = "type")]
    kind: String,
}

const IMAGE_EXTENSIONS: [&str; 6] = ["jpeg", "jpg", "png", "gif", "svg", "webp"];

/// List a directory, tagging each entry as a directory or an image.
///
/// Image-path completion needs both the names and their kinds. Asking through
/// `readdir` and then `is_directory` / `is_image` per entry would be one round
/// trip per file for something the OS already told us while reading the
/// directory.
#[tauri::command]
pub fn readdir_kinds(path: String) -> Result<Vec<DirEntryKind>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        let kind = if meta.is_dir() {
            "directory"
        } else if meta.is_file()
            && Path::new(&file)
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
                .unwrap_or(false)
        {
            "image"
        } else {
            ""
        };
        entries.push(DirEntryKind {
            file,
            kind: kind.to_string(),
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn readdir(path: String) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    Ok(names)
}

#[tauri::command]
pub fn stat(path: String) -> Result<SerializedStat, String> {
    let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    Ok(SerializedStat {
        size: meta.len() as f64,
        mtime_ms,
        is_file: meta.is_file(),
        is_directory: meta.is_dir(),
        is_symbolic_link: meta.file_type().is_symlink(),
    })
}

/// The renderer sends either a UTF-8 string or a byte array for writes. This
/// untagged enum accepts both so `writeFile`/`outputFile` keep their old shape.
#[derive(serde::Deserialize)]
#[serde(untagged)]
pub enum FileWriteData {
    Text(String),
    Binary(Vec<u8>),
}

impl FileWriteData {
    fn into_bytes(self) -> Vec<u8> {
        match self {
            FileWriteData::Text(s) => s.into_bytes(),
            FileWriteData::Binary(b) => b,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("folira-fs-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn merge_keeps_the_keys_of_a_bom_prefixed_file() {
        let dir = temp_dir("merge-bom");
        let path = dir.join("preferences.json");
        // Windows editors write the byte-order mark more often than not, and a
        // BOM makes the whole file unparseable as JSON.
        fs::write(
            &path,
            b"\xef\xbb\xbf{\n  \"theme\": \"graphite\",\n  \"fontSize\": 15\n}\n",
        )
        .unwrap();

        merge_json_file(
            path.to_string_lossy().into_owned(),
            json!({ "sideBarVisibility": true }),
        )
        .unwrap();

        let merged: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(merged["theme"], "graphite");
        assert_eq!(merged["fontSize"], 15);
        assert_eq!(merged["sideBarVisibility"], true);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_creates_the_file_and_rejects_a_patch_that_is_not_an_object() {
        let dir = temp_dir("merge-create");
        let path = dir.join("preferences.json");

        merge_json_file(
            path.to_string_lossy().into_owned(),
            json!({ "autoSave": true }),
        )
        .unwrap();
        let created: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(created, json!({ "autoSave": true }));

        assert!(merge_json_file(path.to_string_lossy().into_owned(), json!([1, 2])).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn raw_reads_preserve_bom_and_non_utf8_bytes() {
        let dir = temp_dir("raw-read");
        let path = dir.join("binary.dat");
        let bytes = vec![0xef, 0xbb, 0xbf, 0xff, 0, 0x80];
        fs::write(&path, &bytes).unwrap();
        match read_file(path.to_string_lossy().into_owned(), None).unwrap() {
            FileData::Binary(actual) => assert_eq!(actual, bytes),
            _ => panic!("raw read returned text"),
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn both_utf8_aliases_strip_only_the_leading_bom_and_preserve_unicode() {
        let dir = temp_dir("text-read");
        let path = dir.join("中文.md");
        fs::write(&path, "\u{feff}中文😀\u{feff}\r\n").unwrap();
        for encoding in ["utf8", "utf-8"] {
            match read_file(path.to_string_lossy().into_owned(), Some(encoding.into())).unwrap() {
                FileData::Text(text) => assert_eq!(text, "中文😀\u{feff}\r\n"),
                _ => panic!("text read returned bytes"),
            }
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn invalid_utf8_is_reported_instead_of_silently_replacing_characters() {
        let dir = temp_dir("invalid-text");
        let path = dir.join("invalid.md");
        fs::write(&path, [0xff, 0xfe, 0x80]).unwrap();
        assert!(read_file(path.to_string_lossy().into_owned(), Some("utf8".into())).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reading_a_missing_file_is_an_error_for_text_and_binary_modes() {
        let dir = temp_dir("missing-read");
        let path = dir.join("missing.md").to_string_lossy().into_owned();
        assert!(read_file(path.clone(), Some("utf8".into())).is_err());
        assert!(read_file(path, None).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn file_commands_create_missing_parents_and_replace_without_leaving_old_bytes() {
        let dir = temp_dir("nested-write");
        let path = dir.join("nested").join("中文.md");
        let name = path.to_string_lossy().into_owned();
        output_file(
            name.clone(),
            FileWriteData::Text("old longer content".into()),
        )
        .unwrap();
        write_file(name, FileWriteData::Binary(vec![0, 255, 128])).unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![0, 255, 128]);
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn invalid_json_patches_leave_the_existing_file_byte_for_byte_unchanged() {
        let dir = temp_dir("invalid-patch");
        let path = dir.join("preferences.json");
        let original = b"{\n  \"fontSize\": 20\n}\n";
        fs::write(&path, original).unwrap();
        for patch in [json!(null), json!([1, 2]), json!("oops"), json!(42)] {
            assert!(merge_json_file(path.to_string_lossy().into_owned(), patch).is_err());
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn json_merge_overrides_only_named_keys_including_explicit_null() {
        let dir = temp_dir("merge-values");
        let path = dir.join("preferences.json");
        fs::write(&path, br#"{"theme":"light","fontSize":16,"keep":{"x":1}}"#).unwrap();
        merge_json_file(
            path.to_string_lossy().into_owned(),
            json!({"theme":null,"fontSize":24}),
        )
        .unwrap();
        let actual: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(actual, json!({"theme":null,"fontSize":24,"keep":{"x":1}}));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn directory_listing_distinguishes_folders_images_and_regular_documents() {
        let dir = temp_dir("entry-kinds");
        fs::create_dir(dir.join("folder.png")).unwrap();
        fs::write(dir.join("IMAGE.PNG"), b"image").unwrap();
        fs::write(dir.join("note.md"), b"text").unwrap();
        let mut entries = readdir_kinds(dir.to_string_lossy().into_owned()).unwrap();
        entries.sort_by(|a, b| a.file.cmp(&b.file));
        let actual: Vec<_> = entries
            .iter()
            .map(|e| (e.file.as_str(), e.kind.as_str()))
            .collect();
        assert_eq!(
            actual,
            vec![
                ("IMAGE.PNG", "image"),
                ("folder.png", "directory"),
                ("note.md", "")
            ]
        );
        let _ = fs::remove_dir_all(dir);
    }
}
