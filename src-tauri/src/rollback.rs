use crate::app::{AppState, Edit};
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::path::Path;
use uuid::Uuid;

/// Error code meaning "ask the user before restoring a legacy row". The renderer matches it by
/// equality (useEditDecision.ts) and owns the wording shown to the user.
pub const LEGACY_CONFIRM: &str = "LEGACY_CONFIRM";
const FILE_CHANGED: &str = "File đã đổi sau thay đổi này";

/// The file's bytes, `None` when it is gone. A path that is no longer a regular file (FIFO, folder,
/// socket) is a changed file: it is refused before any read, which would block on a FIFO.
fn read_current(path: &Path) -> Result<Option<Vec<u8>>> {
    match std::fs::metadata(path) {
        Ok(m) if !m.is_file() => return Err(anyhow!(FILE_CHANGED)),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Runs before any write. Ok(true): restore the before content. Ok(false): the file already
/// holds it, so only the status changes. Err: nothing is written.
fn check_file(state: &AppState, edit: &Edit, confirm_legacy: bool) -> Result<bool> {
    let current = read_current(Path::new(&edit.path))?;
    let already_before = match (&edit.before_blob_sha, current.as_deref()) {
        (Some(sha), Some(bytes)) => state.blobs.read_bytes(sha)? == bytes,
        (None, None) => true,
        _ => false,
    };
    if already_before {
        return Ok(false);
    }
    let deleted = edit.tool == "FS::Delete";
    if edit.after_blob_sha.is_empty() && !deleted {
        return check_legacy(&edit.before_blob_sha, &current, confirm_legacy);
    }
    let unchanged = if deleted {
        current.is_none()
    } else {
        current.as_deref() == Some(state.blobs.read_bytes(&edit.after_blob_sha)?.as_slice())
    };
    if unchanged {
        Ok(true)
    } else {
        Err(anyhow!(FILE_CHANGED))
    }
}

/// A row the old hook wrote with no after content, whose file differs from BEFORE: restore only
/// after the user confirmed. A before blob with no file on disk is a changed file.
fn check_legacy(
    before: &Option<String>,
    current: &Option<Vec<u8>>,
    confirm_legacy: bool,
) -> Result<bool> {
    if before.is_some() && current.is_none() {
        Err(anyhow!(FILE_CHANGED))
    } else if confirm_legacy {
        Ok(true)
    } else {
        Err(anyhow!(LEGACY_CONFIRM))
    }
}

const OUTSIDE_PROJECT: &str = "File nằm ngoài thư mục project, không khôi phục.";

/// A restore writes or deletes exactly at the recorded path only when no existing folder on that path is a
/// link: the nearest existing folder of the path must equal its own canonical form. A project root or a
/// parent folder replaced by a link is refused whether the project is registered, removed, or the row is
/// legacy. A folder that cannot be resolved (dangling link, loop, permission error) is refused too.
/// Touches no database, so it runs inside the `transition` closure, right before the write.
fn confine_to_recorded_path(path: &Path) -> Result<()> {
    let mut dir = path.parent();
    while let Some(d) = dir {
        match std::fs::symlink_metadata(d) {
            Ok(_) => {
                return match d.canonicalize() {
                    Ok(real) if real == d => Ok(()),
                    _ => Err(anyhow!(OUTSIDE_PROJECT)),
                };
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => dir = d.parent(),
            Err(_) => return Err(anyhow!(OUTSIDE_PROJECT)),
        }
    }
    Err(anyhow!(OUTSIDE_PROJECT))
}

fn restore_before(state: &AppState, edit: &Edit) -> Result<()> {
    let path = Path::new(&edit.path);
    match &edit.before_blob_sha {
        Some(sha) => state.blobs.restore_to(sha, path),
        None => match std::fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        },
    }
}

pub fn reject(state: &AppState, edit_id: &str, confirm_legacy: bool) -> Result<()> {
    let edit = state.db.get_edit(edit_id)?;
    if edit.status != "pending" && edit.status != "pending_decision" {
        return Err(anyhow!("cannot reject edit with status {}", edit.status));
    }
    let write = check_file(state, &edit, confirm_legacy)?;
    state.db.transition(
        edit_id,
        &["pending", "pending_decision"],
        "rejected",
        |_| {
            if write {
                confine_to_recorded_path(Path::new(&edit.path))?;
                restore_before(state, &edit)?;
            }
            Ok(())
        },
    )
}

pub fn undo_accepted(state: &AppState, edit_id: &str, confirm_legacy: bool) -> Result<()> {
    let edit = state.db.get_edit(edit_id)?;
    if edit.status != "accepted" && edit.status != "auto_accepted" {
        return Err(anyhow!(
            "can only rollback accepted/auto_accepted edits (got {})",
            edit.status
        ));
    }
    let write = check_file(state, &edit, confirm_legacy)?;
    state.db.transition(
        edit_id,
        &["accepted", "auto_accepted"],
        "rolled_back",
        |conn| {
            let path = Path::new(&edit.path);
            if write {
                confine_to_recorded_path(path)?;
            }
            let current_sha = if path.exists() {
                state.blobs.store_file(path)?
            } else {
                String::new()
            };
            if write {
                restore_before(state, &edit)?;
            }
            let rb = Edit {
                id: Uuid::new_v4().to_string(),
                session_id: edit.session_id.clone(),
                tool: format!("Rollback({})", edit.tool),
                path: edit.path.clone(),
                before_blob_sha: Some(current_sha),
                after_blob_sha: edit.before_blob_sha.clone().unwrap_or_default(),
                status: "rolled_back".into(),
                hook_phase: "post".into(),
                created_at: Utc::now().to_rfc3339(),
                decided_at: Some(Utc::now().to_rfc3339()),
                explanation_md: None,
                explanation_cached_at: None,
                rollback_of_edit_id: Some(edit_id.into()),
            };
            crate::db::Db::insert_edit_on(conn, &rb)
        },
    )
}

#[cfg(test)]
mod tests {
    //! Rollback-flow unit tests.
    //!
    //! Covers the two entry points: `reject` (undo a pending edit) and
    //! `undo_accepted` (rollback after Accept). Both use the shared
    //! `test_support::test_state` fixture for an isolated DB + blob store.
    use super::*;
    use crate::test_support::test_state;
    use std::fs;

    /// Build a synthetic Edit row + supporting blobs, write the "after" content
    /// to a real path on disk, and return (edit_id, file_path) for the test.
    fn seed_pending_edit(
        state: &AppState,
        before_content: Option<&[u8]>,
        after_content: &[u8],
        target_dir: &std::path::Path,
    ) -> (String, std::path::PathBuf) {
        fs::create_dir_all(target_dir).unwrap();
        // canonical: a restore refuses a path that runs through a link (macOS temp dirs sit under /var)
        let path = target_dir.canonicalize().unwrap().join("target.txt");
        fs::write(&path, after_content).unwrap();

        let before_sha = before_content.map(|c| state.blobs.store_bytes(c).unwrap());
        let after_sha = state.blobs.store_bytes(after_content).unwrap();

        let id = uuid::Uuid::new_v4().to_string();
        let edit = Edit {
            id: id.clone(),
            session_id: None,
            tool: "Edit".into(),
            path: path.to_string_lossy().to_string(),
            before_blob_sha: before_sha,
            after_blob_sha: after_sha,
            status: "pending".into(),
            hook_phase: "post".into(),
            created_at: Utc::now().to_rfc3339(),
            decided_at: None,
            explanation_md: None,
            explanation_cached_at: None,
            rollback_of_edit_id: None,
        };
        state.db.insert_edit(&edit).unwrap();
        (id, path)
    }

    #[test]
    fn reject_pending_restores_before_blob() {
        // Reject acceptance criterion: target file content == before_blob bytes
        // after reject. Confirms blob_store.restore_to was called on the right sha.
        let ts = test_state();
        let (id, path) = seed_pending_edit(
            &ts.state,
            Some(b"before content"),
            b"after content",
            ts._tmp.path(),
        );

        reject(&ts.state, &id, false).expect("reject pending");

        let restored = fs::read_to_string(&path).unwrap();
        assert_eq!(restored, "before content");

        let row = ts.state.db.get_edit(&id).unwrap();
        assert_eq!(row.status, "rejected");
    }

    #[test]
    fn reject_pending_with_no_before_blob_deletes_file() {
        // Edge case: file was newly-created by Claude (no before_blob_sha).
        // Reject must remove the file rather than restore from absent blob.
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, None, b"newly created file", ts._tmp.path());
        assert!(path.exists());

        reject(&ts.state, &id, false).expect("reject new-file edit");

        assert!(
            !path.exists(),
            "newly-created file must be removed on reject"
        );
    }

    #[test]
    fn reject_refuses_non_pending() {
        // Status guard: only `pending` is rejectable. Already-accepted edits
        // must be rolled back via `undo_accepted`, not via reject.
        let ts = test_state();
        let (id, _path) = seed_pending_edit(&ts.state, Some(b"before"), b"after", ts._tmp.path());
        ts.state.db.set_status(&id, "accepted").unwrap();

        let err = reject(&ts.state, &id, false).expect_err("reject must refuse accepted edits");
        let msg = format!("{}", err);
        assert!(
            msg.contains("cannot reject"),
            "error must explain refusal, got: {}",
            msg
        );
    }

    #[test]
    fn undo_accepted_creates_rollback_row_and_restores() {
        // Acceptance criterion tc-9.1: undo accepted edit creates a new edit row
        // with status=rolled_back AND restores file to before_blob content.
        let ts = test_state();
        let (id, path) = seed_pending_edit(
            &ts.state,
            Some(b"v1 original"),
            b"v2 accepted",
            ts._tmp.path(),
        );
        ts.state.db.set_status(&id, "accepted").unwrap();

        undo_accepted(&ts.state, &id, false).expect("undo accepted");

        // File restored to v1.
        let restored = fs::read_to_string(&path).unwrap();
        assert_eq!(restored, "v1 original");

        // Original edit row marked rolled_back.
        let original = ts.state.db.get_edit(&id).unwrap();
        assert_eq!(original.status, "rolled_back");

        // A new audit-trail row exists pointing back to the original edit.
        let all = ts
            .state
            .db
            .list_edits(crate::app::EditFilter {
                status: Some("rolled_back".into()),
                project: None,
                limit: Some(100),
                since: None,
                until: None,
            })
            .unwrap();
        // Two rows now have status=rolled_back: the original (post set_status)
        // plus the new audit row inserted by undo_accepted.
        assert!(
            all.iter()
                .any(|e| e.rollback_of_edit_id.as_deref() == Some(id.as_str())),
            "audit row must point back to original edit"
        );
    }

    /// A row with an explicit tool, status and after sha, for the delete and legacy cases.
    fn seed_row(
        state: &AppState,
        tool: &str,
        status: &str,
        before_content: Option<&[u8]>,
        after_sha: String,
        file_content: Option<&[u8]>,
        target_dir: &std::path::Path,
    ) -> (String, std::path::PathBuf) {
        fs::create_dir_all(target_dir).unwrap();
        let path = target_dir
            .canonicalize()
            .unwrap()
            .join(format!("{}.txt", uuid::Uuid::new_v4()));
        if let Some(content) = file_content {
            fs::write(&path, content).unwrap();
        }
        let id = uuid::Uuid::new_v4().to_string();
        let edit = Edit {
            id: id.clone(),
            session_id: None,
            tool: tool.into(),
            path: path.to_string_lossy().to_string(),
            before_blob_sha: before_content.map(|c| state.blobs.store_bytes(c).unwrap()),
            after_blob_sha: after_sha,
            status: status.into(),
            hook_phase: "post".into(),
            created_at: Utc::now().to_rfc3339(),
            decided_at: None,
            explanation_md: None,
            explanation_cached_at: None,
            rollback_of_edit_id: None,
        };
        state.db.insert_edit(&edit).unwrap();
        (id, path)
    }

    #[test]
    fn reject_after_the_file_changed_again_writes_nothing_and_keeps_the_status() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, Some(b"v1"), b"v2", ts._tmp.path());
        fs::write(&path, b"v3").unwrap();

        let err = reject(&ts.state, &id, false).expect_err("E3");

        assert_eq!(err.to_string(), "File đã đổi sau thay đổi này");
        assert_eq!(fs::read(&path).unwrap(), b"v3");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "pending");
    }

    #[test]
    fn rollback_after_the_file_changed_again_writes_nothing_and_adds_no_audit_row() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, Some(b"v1"), b"v2", ts._tmp.path());
        ts.state.db.set_status(&id, "accepted").unwrap();
        fs::write(&path, b"v3").unwrap();

        let err = undo_accepted(&ts.state, &id, false).expect_err("E3");

        assert_eq!(err.to_string(), "File đã đổi sau thay đổi này");
        assert_eq!(fs::read(&path).unwrap(), b"v3");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "accepted");
        let rolled_back = ts
            .state
            .db
            .list_edits(crate::app::EditFilter {
                status: Some("rolled_back".into()),
                project: None,
                limit: Some(100),
                since: None,
                until: None,
            })
            .unwrap();
        assert!(
            rolled_back.is_empty(),
            "a refused rollback must not insert an audit row"
        );
    }

    #[test]
    fn reject_of_a_delete_change_stops_when_the_file_was_recreated() {
        let ts = test_state();
        let (id, path) = seed_row(
            &ts.state,
            "FS::Delete",
            "pending",
            Some(b"was here"),
            String::new(),
            Some(b"recreated"),
            ts._tmp.path(),
        );

        let err = reject(&ts.state, &id, false).expect_err("E3");

        assert_eq!(err.to_string(), "File đã đổi sau thay đổi này");
        assert_eq!(fs::read(&path).unwrap(), b"recreated");
    }

    #[test]
    fn reject_of_a_delete_change_restores_the_file_while_it_is_still_gone() {
        let ts = test_state();
        let (id, path) = seed_row(
            &ts.state,
            "FS::Delete",
            "pending",
            Some(b"was here"),
            String::new(),
            None,
            ts._tmp.path(),
        );

        reject(&ts.state, &id, false).expect("reject delete");

        assert_eq!(fs::read(&path).unwrap(), b"was here");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "rejected");
    }

    #[cfg(unix)]
    #[test]
    fn a_failing_remove_returns_the_error_and_keeps_the_status() {
        use std::os::unix::fs::PermissionsExt;
        let ts = test_state();
        let dir = ts._tmp.path().join("ro");
        let (id, path) = seed_pending_edit(&ts.state, None, b"new file", &dir);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let can_write_anyway = fs::write(dir.join("probe"), b"x").is_ok();

        let result = reject(&ts.state, &id, false);

        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        if can_write_anyway {
            return; // running as root: the directory is not really read-only
        }
        assert!(
            result.is_err(),
            "a remove error must be returned, not swallowed"
        );
        assert!(path.exists());
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "pending");
    }

    #[test]
    fn reject_works_on_a_pending_decision_change() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, Some(b"before"), b"after", ts._tmp.path());
        ts.state.db.set_status(&id, "pending_decision").unwrap();

        reject(&ts.state, &id, false).expect("reject pending_decision");

        assert_eq!(fs::read(&path).unwrap(), b"before");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "rejected");
    }

    #[test]
    fn a_crlf_file_equal_to_its_after_blob_is_not_a_false_positive() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(
            &ts.state,
            Some(b"a\r\nb\r\n"),
            b"a\r\nc\r\n",
            ts._tmp.path(),
        );

        reject(&ts.state, &id, false).expect("byte-equal CRLF content passes the check");

        assert_eq!(fs::read(&path).unwrap(), b"a\r\nb\r\n");
    }

    #[test]
    fn a_legacy_row_equal_to_its_before_content_is_rejected_without_asking() {
        let ts = test_state();
        let (id, path) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            Some(b"same"),
            String::new(),
            Some(b"same"),
            ts._tmp.path(),
        );

        reject(&ts.state, &id, false).expect("nothing to undo");

        assert_eq!(fs::read(&path).unwrap(), b"same");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "rejected");
    }

    #[test]
    fn a_legacy_row_that_differs_needs_confirmation_and_writes_nothing_without_it() {
        let ts = test_state();
        let (id, path) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            Some(b"older"),
            String::new(),
            Some(b"newer"),
            ts._tmp.path(),
        );

        let err = reject(&ts.state, &id, false).expect_err("needs confirmation");

        assert_eq!(err.to_string(), LEGACY_CONFIRM);
        assert_eq!(fs::read(&path).unwrap(), b"newer");
        assert_eq!(
            ts.state.db.get_edit(&id).unwrap().status,
            "pending_decision"
        );
    }

    #[test]
    fn a_confirmed_legacy_row_is_restored_to_its_before_content() {
        let ts = test_state();
        let (id, path) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            Some(b"older"),
            String::new(),
            Some(b"newer"),
            ts._tmp.path(),
        );

        reject(&ts.state, &id, true).expect("confirmed");

        assert_eq!(fs::read(&path).unwrap(), b"older");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "rejected");
    }

    #[test]
    fn a_confirmed_legacy_row_with_no_before_blob_removes_the_file() {
        let ts = test_state();
        let (id, path) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            None,
            String::new(),
            Some(b"created"),
            ts._tmp.path(),
        );
        assert_eq!(
            reject(&ts.state, &id, false)
                .expect_err("asks first")
                .to_string(),
            LEGACY_CONFIRM
        );

        reject(&ts.state, &id, true).expect("confirmed");

        assert!(!path.exists());
    }

    #[test]
    fn a_legacy_row_with_a_before_blob_and_no_file_is_e3_even_when_confirmed() {
        let ts = test_state();
        let (id, _path) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            Some(b"older"),
            String::new(),
            None,
            ts._tmp.path(),
        );

        let err = reject(&ts.state, &id, true).expect_err("E3");

        assert_eq!(err.to_string(), "File đã đổi sau thay đổi này");
    }

    #[test]
    fn check_file_tells_recorded_rows_from_legacy_rows() {
        let ts = test_state();
        let dir = ts._tmp.path();
        let get = |id: &str| ts.state.db.get_edit(id).unwrap();

        let (id, _) = seed_pending_edit(&ts.state, Some(b"v1"), b"v2", &dir.join("rec"));
        assert!(
            check_file(&ts.state, &get(&id), false).unwrap(),
            "recorded and unchanged: restore"
        );

        let (id, _) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            Some(b"same"),
            String::new(),
            Some(b"same"),
            dir,
        );
        assert!(
            !check_file(&ts.state, &get(&id), false).unwrap(),
            "legacy equal to before: no write"
        );

        let (id, _) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            None,
            String::new(),
            None,
            dir,
        );
        assert!(
            !check_file(&ts.state, &get(&id), false).unwrap(),
            "legacy, nothing on disk, no before: no write"
        );

        let (id, _) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            Some(b"old"),
            String::new(),
            Some(b"newer"),
            dir,
        );
        assert!(
            check_file(&ts.state, &get(&id), true).unwrap(),
            "legacy, differs, confirmed: write"
        );
    }

    #[test]
    fn rejecting_every_listed_id_leaves_a_legacy_row_as_a_failed_item() {
        // reject_all (app.rs) is this loop: list the ids, reject each with confirm_legacy false.
        let ts = test_state();
        let dir = ts._tmp.path();
        let (_, a_path) =
            seed_pending_edit(&ts.state, Some(b"a-before"), b"a-after", &dir.join("a"));
        let (_, b_path) =
            seed_pending_edit(&ts.state, Some(b"b-before"), b"b-after", &dir.join("b"));
        let (legacy, legacy_path) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            Some(b"old"),
            String::new(),
            Some(b"newer"),
            dir,
        );

        let mut ok = 0;
        let mut errs = Vec::new();
        for id in ts.state.db.list_pending_ids(None).unwrap() {
            match reject(&ts.state, &id, false) {
                Ok(_) => ok += 1,
                Err(e) => errs.push(format!("{}: {}", id, e)),
            }
        }

        assert_eq!(ok, 2);
        assert_eq!(errs, vec![format!("{legacy}: {LEGACY_CONFIRM}")]);
        assert_eq!(fs::read(&a_path).unwrap(), b"a-before");
        assert_eq!(fs::read(&b_path).unwrap(), b"b-before");
        assert_eq!(fs::read(&legacy_path).unwrap(), b"newer");
    }

    #[test]
    fn legacy_confirm_is_an_ascii_code() {
        assert_eq!(LEGACY_CONFIRM, "LEGACY_CONFIRM");
    }

    #[test]
    fn legacy_error_to_string_is_the_code() {
        let ts = test_state();
        let (id, _) = seed_row(
            &ts.state,
            "Edit",
            "pending_decision",
            Some(b"o"),
            String::new(),
            Some(b"n"),
            ts._tmp.path(),
        );
        assert_eq!(
            reject(&ts.state, &id, false).unwrap_err().to_string(),
            "LEGACY_CONFIRM"
        );
    }

    #[test]
    fn transition_from_a_status_outside_from_fails_and_keeps_the_status() {
        let ts = test_state();
        let (id, _) = seed_pending_edit(&ts.state, Some(b"b"), b"a", ts._tmp.path());
        ts.state.db.set_status(&id, "accepted").unwrap();
        let err =
            ts.state.db.transition(
                &id,
                &["pending", "pending_decision"],
                "rejected",
                |_| Ok(()),
            );
        assert_eq!(
            err.unwrap_err().to_string(),
            "cannot reject edit with status accepted"
        );
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "accepted");
    }

    #[test]
    fn transition_rolls_back_the_status_when_work_fails() {
        let ts = test_state();
        let (id, _) = seed_pending_edit(&ts.state, Some(b"b"), b"a", ts._tmp.path());
        let err = ts
            .state
            .db
            .transition(&id, &["pending"], "rejected", |_| Err(anyhow!("boom")));
        assert_eq!(err.unwrap_err().to_string(), "boom");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "pending");
    }

    #[test]
    fn reject_after_concurrent_accept_fails_and_keeps_file() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, Some(b"v1"), b"v2", ts._tmp.path());
        let edit = ts.state.db.get_edit(&id).unwrap();
        let write = check_file(&ts.state, &edit, false).unwrap();
        assert!(write);
        // the accept lands between the check and the decision
        ts.state.db.accept_pending(&id).unwrap();
        let err = ts
            .state
            .db
            .transition(&id, &["pending", "pending_decision"], "rejected", |_| {
                restore_before(&ts.state, &edit)
            });
        assert!(err.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"v2");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "accepted");
    }

    #[test]
    fn reject_when_file_already_before_completes() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, Some(b"v1"), b"v2", ts._tmp.path());
        fs::write(&path, b"v1").unwrap();
        reject(&ts.state, &id, false).expect("already before");
        assert_eq!(fs::read(&path).unwrap(), b"v1");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "rejected");
    }

    #[test]
    fn rollback_after_concurrent_rollback_fails_and_adds_no_audit_row() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, Some(b"v1"), b"v2", ts._tmp.path());
        ts.state.db.set_status(&id, "accepted").unwrap();
        let edit = ts.state.db.get_edit(&id).unwrap();
        assert!(check_file(&ts.state, &edit, false).unwrap());
        ts.state.db.set_status(&id, "rolled_back").unwrap();
        let err =
            ts.state
                .db
                .transition(&id, &["accepted", "auto_accepted"], "rolled_back", |_| {
                    restore_before(&ts.state, &edit)
                });
        assert!(err.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"v2");
    }

    #[test]
    fn rollback_when_file_already_before_completes_with_audit_row() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, Some(b"v1"), b"v2", ts._tmp.path());
        ts.state.db.set_status(&id, "accepted").unwrap();
        fs::write(&path, b"v1").unwrap();
        undo_accepted(&ts.state, &id, false).expect("already before");
        assert_eq!(fs::read(&path).unwrap(), b"v1");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "rolled_back");
        let rows = ts
            .state
            .db
            .list_edits(crate::app::EditFilter {
                status: Some("rolled_back".into()),
                project: None,
                limit: Some(100),
                since: None,
                until: None,
            })
            .unwrap();
        assert!(rows
            .iter()
            .any(|e| e.rollback_of_edit_id.as_deref() == Some(id.as_str())));
    }

    /// Inserts a pending row for `path` with no file written.
    #[cfg(unix)]
    fn insert_row(
        state: &AppState,
        tool: &str,
        path: &std::path::Path,
        before: Option<&[u8]>,
        after: &[u8],
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let edit = Edit {
            id: id.clone(),
            session_id: None,
            tool: tool.into(),
            path: path.to_string_lossy().to_string(),
            before_blob_sha: before.map(|c| state.blobs.store_bytes(c).unwrap()),
            after_blob_sha: if after.is_empty() {
                String::new()
            } else {
                state.blobs.store_bytes(after).unwrap()
            },
            status: "pending".into(),
            hook_phase: "post".into(),
            created_at: Utc::now().to_rfc3339(),
            decided_at: None,
            explanation_md: None,
            explanation_cached_at: None,
            rollback_of_edit_id: None,
        };
        state.db.insert_edit(&edit).unwrap();
        id
    }

    /// Registers `dir` as project p1 and inserts a pending row for `path` with no file written.
    #[cfg(unix)]
    fn register_and_seed(
        state: &AppState,
        dir: &std::path::Path,
        tool: &str,
        path: &std::path::Path,
        before: Option<&[u8]>,
        after: &[u8],
    ) -> String {
        state
            .db
            .insert_project(&crate::app::Project {
                id: "p1".into(),
                name: "demo".into(),
                path: dir.to_string_lossy().to_string(),
                color: None,
                added_at: "2026-10-01T00:00:00Z".into(),
                last_opened_at: None,
            })
            .unwrap();
        insert_row(state, tool, path, before, after)
    }

    #[cfg(unix)]
    const OUTSIDE_TEXT: &str = "File nằm ngoài thư mục project, không khôi phục.";

    /// Project `proj` holds a.md ("new") and two rows for it (an edit and a create); then the root is
    /// moved aside and replaced by a link to `outside`, which holds a.md ("new"). Returns
    /// (edit row, create row, outside).
    #[cfg(unix)]
    fn project_root_turned_into_a_link(
        ts: &crate::test_support::TestState,
    ) -> (String, String, std::path::PathBuf) {
        let tmp = ts._tmp.path().canonicalize().unwrap();
        let proj = tmp.join("proj");
        let outside = tmp.join("outside");
        fs::create_dir_all(&proj).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let path = proj.join("a.md");
        fs::write(&path, "new").unwrap();
        let edit_row = register_and_seed(&ts.state, &proj, "Edit", &path, Some(b"old"), b"new");
        let create_row = insert_row(&ts.state, "Write", &path, None, b"new");
        fs::rename(&proj, tmp.join("moved")).unwrap();
        fs::write(outside.join("a.md"), "new").unwrap();
        std::os::unix::fs::symlink(&outside, &proj).unwrap();
        (edit_row, create_row, outside)
    }

    #[cfg(unix)]
    #[test]
    fn reject_does_not_restore_when_the_project_root_became_a_link() {
        let ts = test_state();
        let (edit_row, create_row, outside) = project_root_turned_into_a_link(&ts);

        let err = reject(&ts.state, &edit_row, false).unwrap_err();
        assert_eq!(err.to_string(), OUTSIDE_TEXT);
        assert_eq!(fs::read_to_string(outside.join("a.md")).unwrap(), "new");
        assert_eq!(ts.state.db.get_edit(&edit_row).unwrap().status, "pending");

        let err = reject(&ts.state, &create_row, false).unwrap_err();
        assert_eq!(err.to_string(), OUTSIDE_TEXT);
        assert!(outside.join("a.md").exists());
        assert_eq!(ts.state.db.get_edit(&create_row).unwrap().status, "pending");
    }

    #[cfg(unix)]
    #[test]
    fn undo_accepted_is_refused_when_the_project_root_became_a_link() {
        let ts = test_state();
        let (edit_row, _, outside) = project_root_turned_into_a_link(&ts);
        ts.state.db.set_status(&edit_row, "accepted").unwrap();

        let err = undo_accepted(&ts.state, &edit_row, false).unwrap_err();
        assert_eq!(err.to_string(), OUTSIDE_TEXT);
        assert_eq!(fs::read_to_string(outside.join("a.md")).unwrap(), "new");
        assert_eq!(ts.state.db.get_edit(&edit_row).unwrap().status, "accepted");
        let rolled_back = ts
            .state
            .db
            .list_edits(crate::app::EditFilter {
                status: Some("rolled_back".into()),
                project: None,
                limit: Some(100),
                since: None,
                until: None,
            })
            .unwrap();
        assert!(
            rolled_back.is_empty(),
            "a refused rollback must not insert an audit row"
        );
    }

    #[cfg(unix)]
    #[test]
    fn reject_does_not_restore_when_the_root_is_a_dangling_link() {
        let ts = test_state();
        let tmp = ts._tmp.path().canonicalize().unwrap();
        let proj = tmp.join("proj");
        let missing = tmp.join("missing");
        // a delete row reaches the write step while the file is gone
        let path = proj.join("a.md");
        let id = register_and_seed(&ts.state, &proj, "FS::Delete", &path, Some(b"old"), b"");
        std::os::unix::fs::symlink(&missing, &proj).unwrap();

        let err = reject(&ts.state, &id, false).unwrap_err();
        assert_eq!(err.to_string(), OUTSIDE_TEXT);
        assert!(!missing.exists());
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "pending");
    }

    #[cfg(unix)]
    #[test]
    fn reject_of_a_removed_project_row_does_not_restore_through_a_parent_turned_into_a_link() {
        let ts = test_state();
        let tmp = ts._tmp.path().canonicalize().unwrap();
        let proj = tmp.join("proj");
        let outside = tmp.join("outside");
        fs::create_dir_all(proj.join("docs")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let path = proj.join("docs/a.md");
        fs::write(&path, "new").unwrap();
        let id = register_and_seed(&ts.state, &proj, "Edit", &path, Some(b"old"), b"new");
        ts.state.db.delete_project("p1").unwrap();
        fs::remove_dir_all(proj.join("docs")).unwrap();
        fs::write(outside.join("a.md"), "new").unwrap();
        std::os::unix::fs::symlink(&outside, proj.join("docs")).unwrap();

        let err = reject(&ts.state, &id, false).unwrap_err();
        assert_eq!(err.to_string(), OUTSIDE_TEXT);
        assert_eq!(fs::read_to_string(outside.join("a.md")).unwrap(), "new");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "pending");
    }

    #[cfg(unix)]
    #[test]
    fn a_row_whose_folder_is_reached_through_a_link_is_refused() {
        let ts = test_state();
        let tmp = ts._tmp.path().canonicalize().unwrap();
        fs::create_dir_all(tmp.join("real")).unwrap();
        fs::write(tmp.join("real/a.md"), "new").unwrap();
        std::os::unix::fs::symlink(tmp.join("real"), tmp.join("alias")).unwrap();
        let id = insert_row(
            &ts.state,
            "Edit",
            &tmp.join("alias/a.md"),
            Some(b"old"),
            b"new",
        );

        let err = reject(&ts.state, &id, false).unwrap_err();
        assert_eq!(err.to_string(), OUTSIDE_TEXT);
        assert_eq!(fs::read_to_string(tmp.join("real/a.md")).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn a_row_under_no_project_on_a_link_free_path_still_restores() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(
            &ts.state,
            Some(b"old"),
            b"new",
            &ts._tmp.path().join("free"),
        );

        reject(&ts.state, &id, false).expect("a link-free path restores");

        assert_eq!(fs::read_to_string(&path).unwrap(), "old");
    }

    /// Runs `f` in a thread and fails the test when it does not return within 5 seconds (a read that
    /// blocks forever on a FIFO).
    #[cfg(unix)]
    fn within_5_seconds<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(f());
        });
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .expect("the call must return within 5 seconds")
    }

    /// Replaces the tracked file by a FIFO.
    #[cfg(unix)]
    fn swap_for_a_fifo(path: &std::path::Path) {
        fs::remove_file(path).unwrap();
        let made = std::process::Command::new("mkfifo")
            .arg(path)
            .status()
            .unwrap();
        assert!(made.success());
    }

    #[cfg(unix)]
    #[test]
    fn reject_of_a_path_swapped_for_a_fifo_returns_within_5_seconds() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, Some(b"v1"), b"v2", ts._tmp.path());
        swap_for_a_fifo(&path);

        let (result, status) = within_5_seconds(move || {
            let result = reject(&ts.state, &id, false);
            (result, ts.state.db.get_edit(&id).unwrap().status)
        });

        assert_eq!(
            result.unwrap_err().to_string(),
            "File đã đổi sau thay đổi này"
        );
        assert_eq!(status, "pending");
    }

    #[cfg(unix)]
    #[test]
    fn rollback_of_a_path_swapped_for_a_fifo_returns_within_5_seconds() {
        let ts = test_state();
        let (id, path) = seed_pending_edit(&ts.state, Some(b"v1"), b"v2", ts._tmp.path());
        ts.state.db.set_status(&id, "accepted").unwrap();
        swap_for_a_fifo(&path);

        let (result, status) = within_5_seconds(move || {
            let result = undo_accepted(&ts.state, &id, false);
            (result, ts.state.db.get_edit(&id).unwrap().status)
        });

        assert_eq!(
            result.unwrap_err().to_string(),
            "File đã đổi sau thay đổi này"
        );
        assert_eq!(status, "accepted");
    }

    #[cfg(unix)]
    #[test]
    fn reject_of_a_delete_does_not_restore_through_a_parent_turned_into_a_link() {
        let ts = test_state();
        let proj = ts._tmp.path().canonicalize().unwrap().join("proj");
        let outside = tempfile::TempDir::new().unwrap();
        fs::create_dir_all(proj.join("docs")).unwrap();
        let path = proj.join("docs/key");
        let id = register_and_seed(&ts.state, &proj, "FS::Delete", &path, Some(b"orig"), b"");
        fs::remove_dir_all(proj.join("docs")).unwrap();
        std::os::unix::fs::symlink(outside.path(), proj.join("docs")).unwrap();

        let err = reject(&ts.state, &id, false).unwrap_err();
        assert_eq!(
            err.to_string(),
            "File nằm ngoài thư mục project, không khôi phục."
        );
        assert!(!outside.path().join("key").exists());
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "pending");
    }

    #[cfg(unix)]
    #[test]
    fn reject_of_a_create_does_not_delete_through_a_parent_turned_into_a_link() {
        let ts = test_state();
        let proj = ts._tmp.path().canonicalize().unwrap().join("proj");
        let outside = tempfile::TempDir::new().unwrap();
        fs::create_dir_all(&proj).unwrap();
        fs::write(outside.path().join("x"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path(), proj.join("docs")).unwrap();
        let path = proj.join("docs/x");
        let id = register_and_seed(&ts.state, &proj, "Write", &path, None, b"x");

        assert!(reject(&ts.state, &id, false).is_err());
        assert!(outside.path().join("x").exists());
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "pending");
    }

    #[cfg(unix)]
    #[test]
    fn reject_inside_a_registered_project_still_restores() {
        let ts = test_state();
        let proj = ts._tmp.path().canonicalize().unwrap().join("proj");
        fs::create_dir_all(proj.join("docs")).unwrap();
        let path = proj.join("docs/a.md");
        fs::write(&path, "after").unwrap();
        let id = register_and_seed(&ts.state, &proj, "Edit", &path, Some(b"before"), b"after");

        reject(&ts.state, &id, false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "before");
        assert_eq!(ts.state.db.get_edit(&id).unwrap().status, "rejected");
    }
}
