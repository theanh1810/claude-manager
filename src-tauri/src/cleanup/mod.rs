//! Cleanup of ~/.claude: scan by metadata and move to the Trash (UC-005).
//!
//! `cleanup_scan` remembers the entries of groups (a) and (b); `cleanup_trash`
//! moves only paths from that list, and never one the never-touch rule names.

pub mod scan;
pub mod trash;

use crate::store::mask_err;
use parking_lot::Mutex;
use scan::CleanupScan;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::State;
use trash::TrashResult;

/// The paths of the latest scan that may be trashed.
#[derive(Default)]
pub struct ScanState(Mutex<HashSet<String>>);

impl ScanState {
    fn remember(&self, scan: &CleanupScan) {
        let mut set = self.0.lock();
        set.clear();
        for e in scan.groups.redundant.iter().chain(&scan.groups.aged) {
            set.insert(e.path.clone());
        }
    }

    fn contains(&self, path: &str) -> bool {
        self.0.lock().contains(path)
    }
}

pub fn claude_root() -> Option<PathBuf> {
    directories::UserDirs::new().map(|d| d.home_dir().join(".claude"))
}

/// Move each path that is in the latest scan and passes the never-touch rule;
/// every other path is rejected and nothing moves for it.
pub fn trash_paths<F: Fn(&Path) -> TrashResult>(
    root: &Path,
    state: &ScanState,
    paths: Vec<String>,
    mover: F,
) -> Vec<TrashResult> {
    paths
        .into_iter()
        .map(|p| {
            let path = PathBuf::from(&p);
            if !state.contains(&p) || scan::never_touch_reason(root, &path).is_some() {
                return TrashResult::rejected(&p, "not in the latest scan");
            }
            mover(&path)
        })
        .collect()
}

#[tauri::command]
pub async fn cleanup_scan(
    cutoff_days: u32,
    state: State<'_, ScanState>,
) -> Result<CleanupScan, String> {
    if !scan::CUTOFFS.contains(&cutoff_days) {
        return Err("cut-off must be 7, 30 or 90 days".to_string());
    }
    let root = claude_root().ok_or_else(|| "cannot locate ~/.claude".to_string())?;
    let result =
        tokio::task::spawn_blocking(move || scan::scan(&root, cutoff_days, SystemTime::now()))
            .await
            .map_err(|e| e.to_string())?
            .map_err(mask_err)?;
    state.remember(&result);
    Ok(result)
}

#[tauri::command]
pub fn cleanup_trash(
    paths: Vec<String>,
    state: State<ScanState>,
) -> Result<Vec<TrashResult>, String> {
    let root = claude_root().ok_or_else(|| "cannot locate ~/.claude".to_string())?;
    Ok(trash_paths(&root, &state, paths, trash::move_to_trash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn state_with(paths: &[&str]) -> ScanState {
        let s = ScanState::default();
        for p in paths {
            s.0.lock().insert(p.to_string());
        }
        s
    }

    fn ok(p: &Path) -> TrashResult {
        TrashResult {
            path: p.to_string_lossy().to_string(),
            ok: true,
            gone: false,
            error: None,
        }
    }

    #[test]
    fn only_paths_of_the_latest_scan_are_moved() {
        let root = Path::new("/home/u/.claude");
        let state = state_with(&["/home/u/.claude/skills.zip"]);
        let moved = RefCell::new(Vec::new());
        let out = trash_paths(
            root,
            &state,
            vec![
                "/home/u/.claude/skills.zip".into(),
                "/home/u/.claude/other.zip".into(),
            ],
            |p| {
                moved.borrow_mut().push(p.to_path_buf());
                ok(p)
            },
        );
        assert!(out[0].ok);
        assert!(!out[1].ok && out[1].error.is_some());
        assert_eq!(moved.borrow().len(), 1);
    }

    #[test]
    fn a_never_touch_path_is_rejected_even_if_it_was_listed() {
        let root = Path::new("/home/u/.claude");
        let state = state_with(&[
            "/home/u/.claude/settings.json.bak.1",
            "/home/u/.claude/agents",
        ]);
        let out = trash_paths(
            root,
            &state,
            vec![
                "/home/u/.claude/settings.json.bak.1".into(),
                "/home/u/.claude/agents".into(),
            ],
            |_| panic!("must not move"),
        );
        assert!(out.iter().all(|r| !r.ok));
    }

    #[test]
    fn trashing_twice_reports_gone_the_second_time() {
        let root = Path::new("/home/u/.claude");
        let state = state_with(&["/home/u/.claude/skills.zip"]);
        let calls = RefCell::new(0);
        let mover = |p: &Path| {
            *calls.borrow_mut() += 1;
            if *calls.borrow() == 1 {
                ok(p)
            } else {
                TrashResult {
                    path: p.to_string_lossy().to_string(),
                    ok: true,
                    gone: true,
                    error: None,
                }
            }
        };
        let first = trash_paths(
            root,
            &state,
            vec!["/home/u/.claude/skills.zip".into()],
            mover,
        );
        let second = trash_paths(
            root,
            &state,
            vec!["/home/u/.claude/skills.zip".into()],
            mover,
        );
        assert!(first[0].ok && !first[0].gone);
        assert!(second[0].ok && second[0].gone && second[0].error.is_none());
    }

    #[test]
    fn one_failure_does_not_stop_the_others() {
        let root = Path::new("/home/u/.claude");
        let paths = [
            "/home/u/.claude/a.zip",
            "/home/u/.claude/b.zip",
            "/home/u/.claude/c.zip",
        ];
        let state = state_with(&paths);
        let out = trash_paths(
            root,
            &state,
            paths.iter().map(|s| s.to_string()).collect(),
            |p| {
                if p.ends_with("b.zip") {
                    TrashResult::rejected(&p.to_string_lossy(), "locked")
                } else {
                    ok(p)
                }
            },
        );
        assert_eq!(out.iter().filter(|r| r.ok).count(), 2);
        assert_eq!(out[1].error.as_deref(), Some("locked"));
    }

    #[test]
    fn a_new_scan_replaces_the_remembered_paths() {
        let state = state_with(&["/old"]);
        let scan = CleanupScan {
            cutoff_days: 30,
            groups: scan::Groups::default(),
        };
        state.remember(&scan);
        assert!(!state.contains("/old"));
    }
}
