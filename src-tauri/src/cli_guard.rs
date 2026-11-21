//! Entry-point guards for the `hook` and `uninstall` arguments an older install may still call.

use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde_json::Value;

const MARKER: &str = "claude-manager:managed-hook";

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    NoFile,
    NothingFound,
    Removed { count: usize, backup: PathBuf },
}

/// Drains stdin so the caller's pipe never blocks; the caller then exits 0.
pub fn hook_noop<R: Read>(mut input: R) -> io::Result<u64> {
    io::copy(&mut input, &mut io::sink())
}

/// Removes every hook entry carrying the managed-hook marker from
/// `<home>/.claude/settings.json`, after copying the original beside it.
pub fn uninstall_at(home: &Path) -> Result<Outcome, String> {
    let path = home.join(".claude").join("settings.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Outcome::NoFile),
        Err(e) => return Err(e.to_string()),
    };
    let mut doc: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mut count = 0;
    if let Some(hooks) = doc.get_mut("hooks").and_then(Value::as_object_mut) {
        for event in ["PreToolUse", "PostToolUse"] {
            let Some(groups) = hooks.get_mut(event).and_then(Value::as_array_mut) else {
                continue;
            };
            let mut kept = Vec::new();
            for mut group in std::mem::take(groups) {
                let mut removed = 0;
                let mut left = 0;
                if let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                    let before = list.len();
                    list.retain(|h| !h.to_string().contains(MARKER));
                    removed = before - list.len();
                    left = list.len();
                }
                count += removed;
                if !(removed > 0 && left == 0) {
                    kept.push(group);
                }
            }
            *groups = kept;
        }
    }
    if count == 0 {
        return Ok(Outcome::NothingFound);
    }
    let target = match std::fs::canonicalize(&path) {
        Ok(target) => target,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Outcome::NoFile),
        Err(e) => return Err(e.to_string()),
    };
    let perms = std::fs::metadata(&target)
        .map_err(|e| e.to_string())?
        .permissions();
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ").to_string();
    let original = std::fs::read(&path).map_err(|e| e.to_string())?;
    let backup = create_backup(&path, &stamp, &original, &perms)?;
    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    replace_file(&target, &text, perms, |from, to| std::fs::rename(from, to))?;
    Ok(Outcome::Removed { count, backup })
}

/// Writes `bytes` to a new `settings.json.claude-manager-bak.<stamp>` beside `path`, opened with
/// create_new and the original mode, so an earlier backup is never overwritten. A taken name gets
/// a -1..-9 suffix; all ten taken is an error and nothing more is written.
fn create_backup(
    path: &Path,
    stamp: &str,
    bytes: &[u8],
    perms: &std::fs::Permissions,
) -> Result<PathBuf, String> {
    let base = format!("settings.json.claude-manager-bak.{stamp}");
    for n in 0..=9 {
        let name = if n == 0 {
            base.clone()
        } else {
            format!("{base}-{n}")
        };
        let backup = path.with_file_name(name);
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            opts.mode(perms.mode() & 0o7777);
        }
        #[cfg(not(unix))]
        let _ = perms;
        match opts.open(&backup) {
            Ok(mut file) => {
                file.write_all(bytes).map_err(|e| e.to_string())?;
                file.sync_all().map_err(|e| e.to_string())?;
                return Ok(backup);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err(format!("no free backup name for {base}"))
}

/// Removes the temp file when dropped, unless it was disarmed after the rename.
struct TempGuard<'a>(Option<&'a Path>);

impl Drop for TempGuard<'_> {
    fn drop(&mut self) {
        if let Some(path) = self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Writes `text` to a temp file beside `target` (created with the original mode, so it is
/// never wider), then renames it over `target`. Any error removes the temp file.
fn replace_file(
    target: &Path,
    text: &str,
    perms: std::fs::Permissions,
    rename: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> Result<(), String> {
    let name = target
        .file_name()
        .ok_or("settings.json has no file name")?
        .to_string_lossy();
    let tmp = target.with_file_name(format!("{name}.claude-manager-tmp"));
    match std::fs::remove_file(&tmp) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        opts.mode(perms.mode() & 0o7777);
    }
    let mut file = opts.open(&tmp).map_err(|e| e.to_string())?;
    let mut guard = TempGuard(Some(&tmp));
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    std::fs::set_permissions(&tmp, perms).map_err(|e| e.to_string())?;
    rename(&tmp, target).map_err(|e| e.to_string())?;
    guard.0 = None;
    Ok(())
}

/// The `uninstall` argument: prints one line and returns the process exit code.
pub fn uninstall() -> i32 {
    let Some(home) = std::env::var_os("HOME") else {
        eprintln!("HOME is not set");
        return 1;
    };
    match uninstall_at(Path::new(&home)) {
        Ok(Outcome::NoFile) => {
            println!("no settings.json, nothing to remove");
            0
        }
        Ok(Outcome::NothingFound) => {
            println!("no claude-manager hook found");
            0
        }
        Ok(Outcome::Removed { count, backup }) => {
            println!(
                "removed {count} claude-manager hook entries; backup: {}",
                backup.display()
            );
            0
        }
        Err(e) => {
            eprintln!("settings.json not changed: {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home_with(settings: &str) -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        std::fs::write(home.path().join(".claude/settings.json"), settings).unwrap();
        home
    }

    fn read(home: &Path) -> String {
        std::fs::read_to_string(home.join(".claude/settings.json")).unwrap()
    }

    const MIXED: &str = r#"{"hooks":{"PostToolUse":[
        {"matcher":"Edit","hooks":[{"type":"command","command":"x hook post # claude-manager:managed-hook"}]},
        {"matcher":"Bash","hooks":[{"type":"command","command":"my-own-hook"}]}]}}"#;

    #[test]
    fn uninstall_keeps_only_the_foreign_hook_and_leaves_a_backup() {
        let home = home_with(MIXED);
        let out = uninstall_at(home.path()).unwrap();
        let Outcome::Removed { count, backup } = out else {
            panic!("{out:?}")
        };
        assert_eq!(count, 1);
        assert!(backup.exists());
        let after = read(home.path());
        assert!(after.contains("my-own-hook") && !after.contains("managed-hook"));
        assert_eq!(std::fs::read_to_string(backup).unwrap(), MIXED);
    }

    #[test]
    #[cfg(unix)]
    fn uninstall_keeps_the_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let home = home_with(MIXED);
        let p = home.path().join(".claude/settings.json");
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)).unwrap();
        uninstall_at(home.path()).unwrap();
        assert_eq!(
            std::fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn uninstall_keeps_the_key_order() {
        let src = r#"{"z":1,"a":2,"hooks":{"PostToolUse":[{"hooks":[{"command":"x # claude-manager:managed-hook"}]}]}}"#;
        let home = home_with(src);
        uninstall_at(home.path()).unwrap();
        let out = read(home.path());
        let (z, a, h) = (
            out.find("\"z\"").unwrap(),
            out.find("\"a\"").unwrap(),
            out.find("\"hooks\"").unwrap(),
        );
        assert!(z < a && a < h);
    }

    #[test]
    fn a_second_uninstall_finds_nothing_and_leaves_the_file_alone() {
        let home = home_with(MIXED);
        uninstall_at(home.path()).unwrap();
        let once = read(home.path());
        assert_eq!(uninstall_at(home.path()).unwrap(), Outcome::NothingFound);
        assert_eq!(read(home.path()), once);
    }

    #[test]
    fn no_settings_file_creates_nothing() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(uninstall_at(home.path()).unwrap(), Outcome::NoFile);
        assert!(!home.path().join(".claude").exists());
    }

    #[test]
    fn unparseable_settings_stay_byte_identical() {
        let home = home_with("{ not json");
        assert!(uninstall_at(home.path()).is_err());
        assert_eq!(read(home.path()), "{ not json");
    }

    #[test]
    fn a_foreign_hook_that_only_names_claude_manager_is_kept() {
        let src =
            r#"{"hooks":{"PostToolUse":[{"hooks":[{"command":"claude-manager hook post"}]}]}}"#;
        let home = home_with(src);
        assert_eq!(uninstall_at(home.path()).unwrap(), Outcome::NothingFound);
        assert_eq!(read(home.path()), src);
    }

    #[cfg(unix)]
    #[test]
    fn uninstall_keeps_a_symlinked_settings_link() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        std::fs::create_dir_all(home.path().join("dotfiles")).unwrap();
        std::fs::write(home.path().join("dotfiles/settings.json"), MIXED).unwrap();
        let link = home.path().join(".claude/settings.json");
        std::os::unix::fs::symlink("../dotfiles/settings.json", &link).unwrap();
        uninstall_at(home.path()).unwrap();
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            std::fs::read_link(&link).unwrap(),
            Path::new("../dotfiles/settings.json")
        );
        let after = std::fs::read_to_string(home.path().join("dotfiles/settings.json")).unwrap();
        assert!(after.contains("my-own-hook") && !after.contains("managed-hook"));
        for dir in [".claude", "dotfiles"] {
            let leftover = std::fs::read_dir(home.path().join(dir)).unwrap().any(|e| {
                e.unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".claude-manager-tmp")
            });
            assert!(!leftover);
        }
        let backup = std::fs::read_dir(home.path().join(".claude"))
            .unwrap()
            .any(|e| {
                e.unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains("claude-manager-bak")
            });
        assert!(backup);
    }

    #[cfg(unix)]
    #[test]
    fn uninstall_on_a_dangling_link_changes_nothing() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        let link = home.path().join(".claude/settings.json");
        std::os::unix::fs::symlink("../missing.json", &link).unwrap();
        assert_eq!(uninstall_at(home.path()).unwrap(), Outcome::NoFile);
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            std::fs::read_dir(home.path().join(".claude"))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn replace_removes_the_temp_file_when_rename_fails() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("settings.json");
        std::fs::write(&target, "old").unwrap();
        let perms = std::fs::metadata(&target).unwrap().permissions();
        let out = replace_file(&target, "new", perms, |_, _| Err(io::Error::other("boom")));
        assert!(out.is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn temp_file_is_created_with_the_original_mode() {
        use std::os::unix::fs::PermissionsExt;
        let home = home_with(MIXED);
        let path = home.path().join(".claude/settings.json");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let perms = std::fs::metadata(&path).unwrap().permissions();
        replace_file(&path, "{}", perms, |from, to| {
            assert_eq!(
                std::fs::metadata(from).unwrap().permissions().mode() & 0o077,
                0
            );
            std::fs::rename(from, to)
        })
        .unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    fn backup_fixture() -> (tempfile::TempDir, PathBuf, std::fs::Permissions) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "orig").unwrap();
        let perms = std::fs::metadata(&path).unwrap().permissions();
        (dir, path, perms)
    }

    #[test]
    fn a_single_backup_keeps_the_plain_name() {
        let (_dir, path, perms) = backup_fixture();
        let backup = create_backup(&path, "S", b"one", &perms).unwrap();
        assert_eq!(
            backup.file_name().unwrap(),
            "settings.json.claude-manager-bak.S"
        );
        assert_eq!(std::fs::read(&backup).unwrap(), b"one");
    }

    #[test]
    fn two_threads_backing_up_with_one_stamp_keep_both_files() {
        let (_dir, path, perms) = backup_fixture();
        let made: Vec<PathBuf> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..2)
                .map(|i| {
                    let (path, perms) = (&path, &perms);
                    s.spawn(move || {
                        create_backup(path, "S", format!("body {i}").as_bytes(), perms).unwrap()
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert_ne!(made[0], made[1]);
        let mut bodies: Vec<String> = made
            .iter()
            .map(|p| std::fs::read_to_string(p).unwrap())
            .collect();
        bodies.sort();
        assert_eq!(bodies, vec!["body 0", "body 1"]);
    }

    #[cfg(unix)]
    #[test]
    fn an_existing_0400_backup_with_the_same_name_gets_a_suffix() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, path, perms) = backup_fixture();
        let taken = dir.path().join("settings.json.claude-manager-bak.S");
        std::fs::write(&taken, "old").unwrap();
        std::fs::set_permissions(&taken, std::fs::Permissions::from_mode(0o400)).unwrap();

        let backup = create_backup(&path, "S", b"new", &perms).unwrap();

        assert_eq!(
            backup.file_name().unwrap(),
            "settings.json.claude-manager-bak.S-1"
        );
        assert_eq!(std::fs::read(&taken).unwrap(), b"old");
        assert_eq!(std::fs::read(&backup).unwrap(), b"new");
    }

    #[test]
    fn ten_taken_names_return_an_error_and_write_nothing_more() {
        let (dir, path, perms) = backup_fixture();
        let base = "settings.json.claude-manager-bak.S";
        std::fs::write(dir.path().join(base), "taken").unwrap();
        for n in 1..=9 {
            std::fs::write(dir.path().join(format!("{base}-{n}")), "taken").unwrap();
        }
        assert!(create_backup(&path, "S", b"new", &perms).is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 11);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "orig");
    }

    #[test]
    fn two_uninstall_runs_on_one_home_leave_two_backups_with_the_original() {
        let home = home_with(MIXED);
        uninstall_at(home.path()).unwrap();
        std::fs::write(home.path().join(".claude/settings.json"), MIXED).unwrap();
        uninstall_at(home.path()).unwrap();
        let backups: Vec<String> = std::fs::read_dir(home.path().join(".claude"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.to_string_lossy().contains("claude-manager-bak"))
            .map(|p| std::fs::read_to_string(p).unwrap())
            .collect();
        assert_eq!(backups.len(), 2);
        assert!(backups.iter().all(|b| b == MIXED));
    }

    #[test]
    fn hook_noop_drains_a_large_stdin() {
        let big = vec![b'x'; 1 << 20];
        assert_eq!(hook_noop(&big[..]).unwrap(), 1 << 20);
    }
}
