//! The settings file: %APPDATA%\SC-overlay\layouts.json (profiles of the widget layout, the active profile, hotkeys).
//!
//! The page owns its content (see ui/js/settings.js); this side reads and writes the text, and reads the hotkeys at
//! start. The hotkeys are not read again until the next start.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_BYTES: usize = 1_000_000;

/// Two saves that overlap must not write the same temporary file.
static WRITE: Mutex<()> = Mutex::new(());

pub fn path() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("SC-overlay").join("layouts.json")
}

/// The file's text, empty when it does not exist or cannot be read.
pub fn read() -> String {
    std::fs::read_to_string(path()).unwrap_or_default()
}

/// What may be written: a JSON object under MAX_BYTES.
pub fn check(text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES {
        return Err("settings too large".into());
    }
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(v) if v.is_object() => Ok(()),
        Ok(_) => Err("settings must be a JSON object".into()),
        Err(e) => Err(format!("settings are not JSON: {e}")),
    }
}

/// Write through a temporary file in the same folder, then rename it over the target. Errors are returned.
pub fn write_to(target: &Path, text: &str) -> Result<(), String> {
    check(text)?;
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let tmp = target.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("cannot replace {}: {e}", target.display())
    })
}

pub fn write(text: &str) -> Result<(), String> {
    write_to(&path(), text)
}

/// Copy the file to layouts.json.bak (a file that does not parse is kept before anything is saved over it).
pub fn backup() -> Result<String, String> {
    let from = path();
    let to = from.with_extension("json.bak");
    std::fs::copy(&from, &to).map_err(|e| format!("cannot copy to {}: {e}", to.display()))?;
    Ok(to.display().to_string())
}

/// A hotkey of the file's "hotkeys" object ("toggle", "palette", "profile"), when there is one.
pub fn hotkey(text: &str, name: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    value.get("hotkeys")?.get(name)?.as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sc-overlay-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("layouts.json")
    }

    #[test]
    fn only_a_json_object_under_the_limit_is_written() {
        assert!(check("{}").is_ok());
        assert!(check("[]").is_err());
        assert!(check("not json").is_err());
        assert!(check(&format!("{{\"a\":\"{}\"}}", "x".repeat(MAX_BYTES))).is_err());
    }

    #[test]
    fn write_creates_the_folder_replaces_the_file_and_leaves_no_temporary() {
        let target = temp("write");
        write_to(&target, "{\"version\":1}").unwrap();
        write_to(&target, "{\"version\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "{\"version\":2}");
        assert!(!target.with_extension("json.tmp").exists());
        assert!(write_to(&target, "nope").is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "{\"version\":2}");
        let _ = std::fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn hotkeys_come_from_the_file() {
        let text = r#"{"hotkeys":{"toggle":" Ctrl+F9 ","palette":"","profile":3}}"#;
        assert_eq!(hotkey(text, "toggle").as_deref(), Some("Ctrl+F9"));
        assert_eq!(hotkey(text, "palette"), None);
        assert_eq!(hotkey(text, "profile"), None);
        assert_eq!(hotkey("{}", "toggle"), None);
        assert_eq!(hotkey("broken", "toggle"), None);
    }
}
