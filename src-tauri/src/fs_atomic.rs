// Atomic file writes + simple lock + mtime/hash for conflict detection.
// The canonical memory files live on disk; we must never clobber user edits.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
pub struct FileMeta {
    pub exists: bool,
    pub mtime_ms: u128,
    pub sha256: String,
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file_atomic(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write to a sibling temp file, fsync, then rename. This is atomic on
    // macOS/Linux for paths on the same filesystem.
    let tmp = target.with_extension(format!(
        "{}.tmp",
        target
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn read_file_if_exists(path: String) -> Result<Option<String>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_mtime_and_hash(path: String) -> Result<FileMeta, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(FileMeta {
            exists: false,
            mtime_ms: 0,
            sha256: String::new(),
        });
    }
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    let mtime = meta
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(FileMeta {
        exists: true,
        mtime_ms: mtime,
        sha256: hash_bytes(&bytes),
    })
}

#[tauri::command]
pub fn acquire_lock(path: String) -> Result<bool, String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Best-effort lock: fail if it exists and is less than 10 minutes old.
    if p.exists() {
        let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
        if let Ok(modified) = meta.modified() {
            if let Ok(age) = SystemTime::now().duration_since(modified) {
                if age.as_secs() < 600 {
                    return Ok(false);
                }
            }
        }
    }
    let mut f = fs::File::create(&p).map_err(|e| e.to_string())?;
    let _ = writeln!(f, "{}", std::process::id());
    Ok(true)
}

#[tauri::command]
pub fn release_lock(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// List .md files in a directory. Returns just filenames, not full paths.
#[tauri::command]
pub fn list_md_files(dir: String) -> Result<Vec<String>, String> {
    let p = Path::new(&dir);
    if !p.exists() || !p.is_dir() {
        return Ok(vec![]);
    }
    let mut names: Vec<String> = Vec::new();
    let entries = fs::read_dir(p).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".md") {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}
