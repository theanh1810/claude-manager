use crate::app::{Edit, EditFilter, Project};
use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A recorded change plus the label written by the session-history match.
/// `source` is `claude`, `unknown` or absent (never matched); `decision` is
/// what Claude Code decided for the matching call. The existing `session_id`
/// carries the label's session when the stored value is NULL.
#[derive(Debug, Serialize, Deserialize)]
pub struct LabeledEdit {
    #[serde(flatten)]
    pub edit: Edit,
    pub source: Option<String>,
    pub decision: Option<String>,
}

pub struct Db {
    // Crate-visible so sibling flat modules can lock the
    // connection without going through `impl Db` shim methods. Kept out of the
    // public API — external callers still cannot reach the raw connection.
    pub(crate) conn: Mutex<Connection>,
}

const MIGRATION_001: &str = include_str!("../../db/migrations/001_init.sql");
const MIGRATION_002: &str = include_str!("../../db/migrations/002_knowledge.sql");
const MIGRATION_003: &str = include_str!("../../db/migrations/003_explain_model_opus_5_5.sql");
const MIGRATION_004: &str = include_str!("../../db/migrations/004_session_index.sql");

/// Normalises an RFC 3339 filter bound to UTC millis so SQLite's julianday parses it.
fn rfc3339_utc(s: &str, what: &str) -> Result<String> {
    let dt = chrono::DateTime::parse_from_rfc3339(s).map_err(|_| anyhow!("invalid {what}"))?;
    Ok(dt
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).context("open sqlite")?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(MIGRATION_001)?;
        // 002 adds knowledge base + practice + plan_comments tables and FTS5
        // virtual table. Requires rusqlite `bundled-full` feature for FTS5.
        conn.execute_batch(MIGRATION_002)?;
        // 003 moves the explain_model default from claude-opus-4-8 to
        // claude-opus-5-5; it must run after 001, whose seed it rewrites.
        conn.execute_batch(MIGRATION_003)?;
        // 004 adds the session-history index and change labels; every statement
        // is IF NOT EXISTS because migrations run on every open.
        conn.execute_batch(MIGRATION_004)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert_edit(&self, edit: &Edit) -> Result<()> {
        let c = self.conn.lock();
        Self::insert_edit_on(&c, edit)
    }

    /// Insert on a connection or transaction the caller already holds.
    pub(crate) fn insert_edit_on(c: &Connection, edit: &Edit) -> Result<()> {
        c.execute(
            "INSERT INTO edits (id, session_id, tool, path, before_blob_sha, after_blob_sha,
                status, hook_phase, created_at, rollback_of_edit_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                edit.id,
                edit.session_id,
                edit.tool,
                edit.path,
                edit.before_blob_sha,
                edit.after_blob_sha,
                edit.status,
                edit.hook_phase,
                edit.created_at,
                edit.rollback_of_edit_id,
            ],
        )?;
        Ok(())
    }

    /// Same filters as `list_edits`, with the label of each change joined in.
    /// `edit.session_id` is filled from the label only when the stored value
    /// is NULL; a change nobody matched keeps `source` and `decision` absent.
    pub fn list_edits_labeled(&self, filter: EditFilter) -> Result<Vec<LabeledEdit>> {
        let c = self.conn.lock();
        let limit = filter.limit.unwrap_or(200);
        let mut sql = String::from(
            "SELECT e.id, COALESCE(e.session_id, l.session_id), e.tool, e.path, e.before_blob_sha,
                    e.after_blob_sha, e.status, e.hook_phase, e.created_at, e.decided_at,
                    e.explanation_md, e.explanation_cached_at, e.rollback_of_edit_id,
                    l.source, l.decision
             FROM edits e LEFT JOIN edit_labels l ON l.edit_id = e.id WHERE 1=1 ",
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = filter.status {
            sql.push_str(" AND e.status = ?");
            params_vec.push(Box::new(s));
        }
        if let Some(p) = filter.project {
            sql.push_str(" AND e.path LIKE ?");
            params_vec.push(Box::new(format!("{}%", p)));
        }
        if let Some(since) = filter.since {
            sql.push_str(" AND julianday(e.created_at) >= julianday(?)");
            params_vec.push(Box::new(rfc3339_utc(&since, "since")?));
        }
        if let Some(until) = filter.until {
            sql.push_str(" AND julianday(e.created_at) <= julianday(?)");
            params_vec.push(Box::new(rfc3339_utc(&until, "until")?));
        }
        sql.push_str(" ORDER BY e.created_at DESC LIMIT ?");
        params_vec.push(Box::new(limit));

        let mut stmt = c.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(params_vec.iter().map(|b| b.as_ref())),
            |row| {
                Ok(LabeledEdit {
                    edit: row_to_edit(row)?,
                    source: row.get(13)?,
                    decision: row.get(14)?,
                })
            },
        )?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn get_edit(&self, id: &str) -> Result<Edit> {
        let c = self.conn.lock();
        let mut stmt = c.prepare(
            "SELECT id, session_id, tool, path, before_blob_sha, after_blob_sha, status,
                    hook_phase, created_at, decided_at, explanation_md, explanation_cached_at,
                    rollback_of_edit_id
             FROM edits WHERE id = ?1",
        )?;
        stmt.query_row(params![id], row_to_edit).map_err(Into::into)
    }

    pub fn get_watched_file(&self, project_id: &str, path: &str) -> Result<Option<String>> {
        let c = self.conn.lock();
        let sha: Option<String> = c
            .query_row(
                "SELECT blob_sha FROM watched_files WHERE project_id = ?1 AND path = ?2",
                params![project_id, path],
                |row| row.get(0),
            )
            .ok();
        Ok(sha)
    }

    pub fn upsert_watched_file(&self, project_id: &str, path: &str, sha: &str) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT INTO watched_files (project_id, path, blob_sha, seen_at)
             VALUES (?1, ?2, ?3, datetime('now'))
             ON CONFLICT(project_id, path) DO UPDATE SET blob_sha = excluded.blob_sha,
                                                        seen_at = excluded.seen_at",
            params![project_id, path, sha],
        )?;
        Ok(())
    }

    pub fn delete_watched_files(&self, project_id: &str) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "DELETE FROM watched_files WHERE project_id = ?1",
            params![project_id],
        )?;
        Ok(())
    }

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare(
            "SELECT id, name, path, color, added_at, last_opened_at
             FROM projects ORDER BY last_opened_at DESC NULLS LAST, added_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                color: row.get(3)?,
                added_at: row.get(4)?,
                last_opened_at: row.get(5)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn insert_project(&self, p: &Project) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT INTO projects (id, name, path, color, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET name = excluded.name, color = excluded.color",
            params![p.id, p.name, p.path, p.color, p.added_at],
        )?;
        Ok(())
    }

    pub fn delete_project(&self, id: &str) -> Result<()> {
        let c = self.conn.lock();
        c.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn touch_project(&self, id: &str) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "UPDATE projects SET last_opened_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn all_blob_shas(&self) -> Result<std::collections::HashSet<String>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare(
            "SELECT before_blob_sha FROM edits WHERE before_blob_sha IS NOT NULL
             UNION SELECT after_blob_sha FROM edits WHERE after_blob_sha != ''
             UNION SELECT blob_sha FROM pre_snapshots",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut set = std::collections::HashSet::new();
        for r in rows {
            set.insert(r?);
        }
        Ok(set)
    }

    pub fn cleanup_old_blobs(&self, retention_days: i64) -> Result<usize> {
        let c = self.conn.lock();
        let mut count = 0;
        let mut stmt =
            c.prepare("SELECT sha256 FROM blobs WHERE last_used_at < datetime('now', ?1)")?;
        let cutoff = format!("-{} days", retention_days);
        let shas: Vec<String> = stmt
            .query_map(params![cutoff], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for sha in &shas {
            c.execute("DELETE FROM blobs WHERE sha256 = ?1", params![sha])?;
            count += 1;
        }
        Ok(count)
    }

    pub fn list_pending_ids(&self, path_prefix: Option<&str>) -> Result<Vec<String>> {
        let c = self.conn.lock();
        let mut stmt = if path_prefix.is_some() {
            c.prepare(
                "SELECT id FROM edits WHERE status IN ('pending', 'pending_decision') AND path LIKE ?1 ORDER BY created_at ASC",
            )?
        } else {
            c.prepare(
                "SELECT id FROM edits WHERE status IN ('pending', 'pending_decision') ORDER BY created_at ASC",
            )?
        };
        let rows = if let Some(prefix) = path_prefix {
            let like = format!("{}%", prefix);
            stmt.query_map(params![like], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        } else {
            stmt.query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        Ok(rows)
    }

    #[cfg(test)]
    pub fn set_status(&self, id: &str, status: &str) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "UPDATE edits SET status = ?1, decided_at = datetime('now') WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    /// Move a change to `to` only from one of `from`, then run `work` in the same transaction.
    /// The UPDATE carries the condition, so a decision landing in between cannot be overwritten;
    /// an Err from `work` rolls the status back. `work` gets the open transaction, because the
    /// connection lock is held and a second `self.conn.lock()` would deadlock.
    pub fn transition(
        &self,
        id: &str,
        from: &[&str],
        to: &str,
        work: impl FnOnce(&Connection) -> Result<()>,
    ) -> Result<()> {
        let mut c = self.conn.lock();
        let tx = c.transaction()?;
        let marks = vec!["?"; from.len()].join(", ");
        let sql = format!(
            "UPDATE edits SET status = ?1, decided_at = datetime('now')
             WHERE id = ?2 AND status IN ({marks})"
        );
        let mut args: Vec<&dyn rusqlite::ToSql> = vec![&to, &id];
        args.extend(from.iter().map(|s| s as &dyn rusqlite::ToSql));
        if tx.execute(&sql, args.as_slice())? == 0 {
            let status: Option<String> = tx
                .query_row("SELECT status FROM edits WHERE id = ?1", params![id], |r| {
                    r.get(0)
                })
                .optional()?;
            let verb = match to {
                "rejected" => "reject",
                "accepted" => "accept",
                _ => "roll back",
            };
            return match status {
                None => Err(anyhow!("edit not found: {id}")),
                Some(status) => Err(anyhow!("cannot {verb} edit with status {status}")),
            };
        }
        work(&tx)?;
        tx.commit()?;
        Ok(())
    }

    /// Accept a change only while the Pending tab shows it (`pending` or `pending_decision`).
    /// One UPDATE carries the condition, so a decision landing in between cannot be overwritten.
    pub fn accept_pending(&self, id: &str) -> Result<()> {
        let c = self.conn.lock();
        let changed = c.execute(
            "UPDATE edits SET status = 'accepted', decided_at = datetime('now')
             WHERE id = ?1 AND status IN ('pending', 'pending_decision')",
            params![id],
        )?;
        if changed > 0 {
            return Ok(());
        }
        let status: Option<String> = c
            .query_row(
                "SELECT status FROM edits WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        match status {
            None => Err(anyhow!("edit not found: {id}")),
            Some(status) => Err(anyhow!("cannot accept edit with status {status}")),
        }
    }

    pub fn save_explanation(&self, id: &str, md: &str) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "UPDATE edits SET explanation_md = ?1, explanation_cached_at = datetime('now')
             WHERE id = ?2",
            params![md, id],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare("SELECT value_json FROM settings WHERE key = ?1")?;
        let result = stmt.query_row(params![key], |row| row.get::<_, String>(0));
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn set_setting(&self, key: &str, value_json: &str) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT INTO settings (key, value_json, updated_at)
             VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                            updated_at = excluded.updated_at",
            params![key, value_json],
        )?;
        Ok(())
    }
}

/// Test-only helpers: tests of this file, rollback.rs and watcher.rs need a
/// plain list and a session row. They are compiled only for tests, so the
/// release build holds none of the six deleted methods.
#[cfg(test)]
impl Db {
    pub(crate) fn list_edits(&self, filter: EditFilter) -> Result<Vec<Edit>> {
        Ok(self
            .list_edits_labeled(filter)?
            .into_iter()
            .map(|l| l.edit)
            .collect())
    }

    pub(crate) fn ensure_session(
        &self,
        session_id: &str,
        project_path: Option<&str>,
    ) -> Result<()> {
        self.conn.lock().execute(
            "INSERT OR IGNORE INTO sessions (id, claude_session_id, project_path, started_at)
             VALUES (?1, ?1, ?2, datetime('now'))",
            params![session_id, project_path],
        )?;
        Ok(())
    }
}

fn row_to_edit(row: &Row) -> rusqlite::Result<Edit> {
    Ok(Edit {
        id: row.get(0)?,
        session_id: row.get(1)?,
        tool: row.get(2)?,
        path: row.get(3)?,
        before_blob_sha: row.get(4)?,
        after_blob_sha: row.get(5)?,
        status: row.get(6)?,
        hook_phase: row.get(7)?,
        created_at: row.get(8)?,
        decided_at: row.get(9)?,
        explanation_md: row.get(10)?,
        explanation_cached_at: row.get(11)?,
        rollback_of_edit_id: row.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    //! Unit tests for the SQLite-backed `Db` access layer.
    //!
    //! Strategy:
    //! - Open an in-memory-equivalent DB via a tempdir fixture (see `test_support`).
    //! - Exercise insert / read / filter / status-transition paths end-to-end.
    //! - Assert the CHECK constraint on `edits.status` rejects unknown values —
    //!   this protects the contract that downstream code can rely on a closed
    //!   set of status strings.

    use super::*;
    use crate::app::{Edit, EditFilter};
    use crate::test_support::test_state;

    /// Build a minimally valid `Edit` row tied to `session_id`. Fields not under
    /// test are filled with deterministic defaults so equality assertions stay
    /// stable across runs.
    fn make_edit(id: &str, session_id: &str, path: &str, status: &str) -> Edit {
        Edit {
            id: id.to_string(),
            session_id: Some(session_id.to_string()),
            tool: "Edit".to_string(),
            path: path.to_string(),
            before_blob_sha: None,
            after_blob_sha: "sha-after".to_string(),
            status: status.to_string(),
            hook_phase: "pre".to_string(),
            created_at: "2026-06-30T00:00:00Z".to_string(),
            decided_at: None,
            explanation_md: None,
            explanation_cached_at: None,
            rollback_of_edit_id: None,
        }
    }

    #[test]
    fn db_in_memory_init_creates_tables() {
        // Opening the DB must apply migration 001 so the `edits` table exists.
        // We probe by running a no-op query against `edits`; absence would
        // surface as `SqliteFailure` from rusqlite.
        let fx = test_state();
        // list_edits on a fresh DB returns Ok(empty) — proves table is present.
        let rows = fx
            .state
            .db
            .list_edits(EditFilter::default())
            .expect("list_edits on fresh schema");
        assert!(rows.is_empty(), "fresh DB must have zero edits");
    }

    #[test]
    fn db_insert_edit_roundtrip() {
        // Insert → get_edit should return the same fields verbatim.
        let fx = test_state();
        fx.state
            .db
            .ensure_session("sess-1", Some("/tmp/proj"))
            .unwrap();
        let edit = make_edit("e-1", "sess-1", "/tmp/proj/a.rs", "pending");
        fx.state.db.insert_edit(&edit).expect("insert");

        let got = fx.state.db.get_edit("e-1").expect("get_edit");
        assert_eq!(got.id, "e-1");
        assert_eq!(got.path, "/tmp/proj/a.rs");
        assert_eq!(got.status, "pending");
        assert_eq!(got.tool, "Edit");
    }

    #[test]
    fn db_set_edit_status_valid_transition() {
        // `pending` → `accepted` is permitted by the CHECK constraint and must
        // update both `status` and `decided_at` (non-null after transition).
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        let edit = make_edit("e-2", "sess-1", "/tmp/x", "pending");
        fx.state.db.insert_edit(&edit).unwrap();

        fx.state
            .db
            .set_status("e-2", "accepted")
            .expect("valid status transition");

        let got = fx.state.db.get_edit("e-2").unwrap();
        assert_eq!(got.status, "accepted");
        assert!(
            got.decided_at.is_some(),
            "decided_at must be set after status change"
        );
    }

    #[test]
    fn db_set_edit_status_invalid_transition_errors() {
        // Migration 001 declares `CHECK (status IN ('pending','pending_decision',
        // 'accepted','rejected','rolled_back','auto_accepted'))`. A value outside
        // that set MUST be rejected — protects downstream code from undefined
        // status strings.
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        let edit = make_edit("e-3", "sess-1", "/tmp/x", "pending");
        fx.state.db.insert_edit(&edit).unwrap();

        let err = fx.state.db.set_status("e-3", "bogus_state");
        assert!(
            err.is_err(),
            "CHECK constraint must reject unknown status value"
        );
    }

    #[test]
    fn accept_pending_accepts_a_pending_change() {
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        fx.state
            .db
            .insert_edit(&make_edit("a-1", "sess-1", "/tmp/x", "pending"))
            .unwrap();

        fx.state.db.accept_pending("a-1").expect("accept pending");

        let got = fx.state.db.get_edit("a-1").unwrap();
        assert_eq!(got.status, "accepted");
        assert!(got.decided_at.is_some());
    }

    #[test]
    fn accept_pending_accepts_a_pending_decision_change() {
        // Old databases hold rows the previous hook left in pending_decision;
        // the Pending tab shows them, so accept must work on them too.
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        fx.state
            .db
            .insert_edit(&make_edit("a-2", "sess-1", "/tmp/x", "pending_decision"))
            .unwrap();

        fx.state
            .db
            .accept_pending("a-2")
            .expect("accept pending_decision");

        assert_eq!(fx.state.db.get_edit("a-2").unwrap().status, "accepted");
    }

    #[test]
    fn accept_pending_refuses_every_other_status_and_changes_nothing() {
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        for status in ["rejected", "accepted", "rolled_back", "auto_accepted"] {
            let id = format!("r-{status}");
            fx.state
                .db
                .insert_edit(&make_edit(&id, "sess-1", "/tmp/x", status))
                .unwrap();

            let err = fx.state.db.accept_pending(&id).expect_err("must refuse");

            assert_eq!(
                err.to_string(),
                format!("cannot accept edit with status {status}")
            );
            let got = fx.state.db.get_edit(&id).unwrap();
            assert_eq!(got.status, status);
            assert!(
                got.decided_at.is_none(),
                "a refused accept must not stamp decided_at"
            );
        }
    }

    #[test]
    fn accept_pending_on_an_unknown_id_says_not_found() {
        let fx = test_state();
        let err = fx.state.db.accept_pending("nope").expect_err("unknown id");
        assert_eq!(err.to_string(), "edit not found: nope");
    }

    #[test]
    fn a_second_accept_on_one_id_returns_the_status_error() {
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        fx.state
            .db
            .insert_edit(&make_edit("s-1", "sess-1", "/tmp/x", "pending"))
            .unwrap();
        fx.state.db.accept_pending("s-1").unwrap();

        let err = fx
            .state
            .db
            .accept_pending("s-1")
            .expect_err("second accept");

        assert_eq!(err.to_string(), "cannot accept edit with status accepted");
    }

    #[test]
    fn two_accepts_racing_on_one_id_succeed_once() {
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        fx.state
            .db
            .insert_edit(&make_edit("c-1", "sess-1", "/tmp/x", "pending"))
            .unwrap();
        let db = &fx.state.db;

        let ok: Vec<bool> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..2)
                .map(|_| s.spawn(|| db.accept_pending("c-1").is_ok()))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        assert_eq!(ok.iter().filter(|accepted| **accepted).count(), 1);
    }

    #[test]
    fn list_pending_ids_includes_pending_decision_in_created_order() {
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        let rows = [
            ("l-3", "/p1/c", "pending", "2026-06-30T00:00:03Z"),
            ("l-1", "/p1/a", "pending_decision", "2026-06-30T00:00:01Z"),
            ("l-2", "/p2/b", "pending", "2026-06-30T00:00:02Z"),
            ("l-4", "/p1/d", "accepted", "2026-06-30T00:00:04Z"),
        ];
        for (id, path, status, at) in rows {
            let mut edit = make_edit(id, "sess-1", path, status);
            edit.created_at = at.to_string();
            fx.state.db.insert_edit(&edit).unwrap();
        }

        assert_eq!(
            fx.state.db.list_pending_ids(None).unwrap(),
            vec!["l-1", "l-2", "l-3"]
        );
        assert_eq!(
            fx.state.db.list_pending_ids(Some("/p1")).unwrap(),
            vec!["l-1", "l-3"]
        );
    }

    #[test]
    fn accepting_every_listed_id_accepts_what_pending_shows_and_nothing_else() {
        // accept_all (app.rs) is this loop: list the ids, then accept_pending each.
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        for (id, status) in [
            ("b-1", "pending"),
            ("b-2", "pending_decision"),
            ("b-3", "rejected"),
        ] {
            fx.state
                .db
                .insert_edit(&make_edit(id, "sess-1", "/tmp/x", status))
                .unwrap();
        }

        let ids = fx.state.db.list_pending_ids(None).unwrap();
        for id in &ids {
            fx.state.db.accept_pending(id).expect("accept listed id");
        }

        assert_eq!(ids.len(), 2);
        assert_eq!(fx.state.db.get_edit("b-1").unwrap().status, "accepted");
        assert_eq!(fx.state.db.get_edit("b-2").unwrap().status, "accepted");
        assert_eq!(fx.state.db.get_edit("b-3").unwrap().status, "rejected");
    }

    #[test]
    fn db_list_edits_filters_by_status() {
        // `EditFilter::status` should narrow the result set. Insert two rows
        // with distinct statuses and assert only the matching one returns.
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        fx.state
            .db
            .insert_edit(&make_edit("e-a", "sess-1", "/p/a", "pending"))
            .unwrap();
        fx.state
            .db
            .insert_edit(&make_edit("e-b", "sess-1", "/p/b", "accepted"))
            .unwrap();

        let only_pending = fx
            .state
            .db
            .list_edits(EditFilter {
                status: Some("pending".to_string()),
                project: None,
                limit: None,
                since: None,
                until: None,
            })
            .unwrap();
        assert_eq!(only_pending.len(), 1);
        assert_eq!(only_pending[0].id, "e-a");
    }

    #[test]
    fn db_list_edits_filters_by_project_prefix() {
        // `EditFilter::project` filters by `path LIKE '<prefix>%'`. Verify that
        // only rows whose `path` starts with the prefix come back.
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        fx.state
            .db
            .insert_edit(&make_edit("e-1", "sess-1", "/a/foo.rs", "pending"))
            .unwrap();
        fx.state
            .db
            .insert_edit(&make_edit("e-2", "sess-1", "/b/bar.rs", "pending"))
            .unwrap();

        let only_a = fx
            .state
            .db
            .list_edits(EditFilter {
                status: None,
                project: Some("/a".to_string()),
                limit: None,
                since: None,
                until: None,
            })
            .unwrap();
        assert_eq!(only_a.len(), 1);
        assert_eq!(only_a[0].path, "/a/foo.rs");
    }

    fn edit_at(id: &str, at: &str) -> Edit {
        let mut e = make_edit(id, "sess-1", &format!("/p/{id}"), "pending");
        e.created_at = at.to_string();
        e
    }

    fn ids_window(db: &Db, since: Option<&str>, until: Option<&str>) -> Result<Vec<String>> {
        db.list_edits(EditFilter {
            status: None,
            project: None,
            limit: None,
            since: since.map(str::to_string),
            until: until.map(str::to_string),
        })
        .map(|rows| rows.into_iter().map(|e| e.id).collect())
    }

    fn ids_since(db: &Db, since: Option<&str>) -> Result<Vec<String>> {
        ids_window(db, since, None)
    }

    #[test]
    fn db_list_edits_since_boundary_is_inclusive() {
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        for (id, at) in [
            ("e-1", "2026-10-27T10:00:00Z"),
            ("e-2", "2026-10-27T10:00:01Z"),
            ("e-3", "2026-10-27T10:00:02Z"),
        ] {
            fx.state.db.insert_edit(&edit_at(id, at)).unwrap();
        }
        assert_eq!(
            ids_since(&fx.state.db, Some("2026-10-27T10:00:01Z")).unwrap(),
            vec!["e-3", "e-2"]
        );
        assert_eq!(ids_since(&fx.state.db, None).unwrap().len(), 3);
    }

    #[test]
    fn db_list_edits_since_compares_instants_not_text() {
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        fx.state
            .db
            .insert_edit(&edit_at("e-1", "2026-10-27T10:00:00.500Z"))
            .unwrap();
        fx.state
            .db
            .insert_edit(&edit_at("e-2", "2026-10-27T17:00:00+07:00"))
            .unwrap();
        assert_eq!(
            ids_since(&fx.state.db, Some("2026-10-27T10:00:00Z"))
                .unwrap()
                .len(),
            2
        );
        assert!(ids_since(&fx.state.db, Some("2026-10-27T10:00:00.600Z"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn db_list_edits_invalid_since_errors() {
        let fx = test_state();
        fx.state.db.ensure_session("sess-1", None).unwrap();
        fx.state
            .db
            .insert_edit(&edit_at("e-1", "2026-10-27T10:00:00Z"))
            .unwrap();
        let err = ids_since(&fx.state.db, Some("yesterday")).unwrap_err();
        assert!(err.to_string().contains("invalid since"));
    }

    fn three_edits(fx: &crate::test_support::TestState) {
        fx.state.db.ensure_session("sess-1", None).unwrap();
        for (id, at) in [
            ("e-1", "2026-10-27T10:00:00Z"),
            ("e-2", "2026-10-27T10:00:01Z"),
            ("e-3", "2026-10-27T10:00:02Z"),
        ] {
            fx.state.db.insert_edit(&edit_at(id, at)).unwrap();
        }
    }

    #[test]
    fn db_list_edits_until_is_inclusive() {
        let fx = test_state();
        three_edits(&fx);
        assert_eq!(
            ids_window(&fx.state.db, None, Some("2026-10-27T10:00:01Z")).unwrap(),
            vec!["e-2", "e-1"]
        );
    }

    #[test]
    fn db_list_edits_window_single_instant_and_offset() {
        let fx = test_state();
        three_edits(&fx);
        let z = "2026-10-27T10:00:01Z";
        assert_eq!(
            ids_window(&fx.state.db, Some(z), Some(z)).unwrap(),
            vec!["e-2"]
        );
        let off = "2026-10-27T17:00:01+07:00";
        assert_eq!(
            ids_window(&fx.state.db, Some(off), Some(off)).unwrap(),
            vec!["e-2"]
        );
    }

    #[test]
    fn db_list_edits_invalid_until_errors() {
        let fx = test_state();
        three_edits(&fx);
        let err = ids_window(&fx.state.db, None, Some("yesterday")).unwrap_err();
        assert!(err.to_string().contains("invalid until"));
    }

    #[test]
    fn db_list_edits_since_lowercase_t_is_normalised() {
        let fx = test_state();
        three_edits(&fx);
        assert_eq!(
            ids_since(&fx.state.db, Some("2026-10-27t10:00:01Z")).unwrap(),
            vec!["e-3", "e-2"]
        );
    }

    #[test]
    fn db_list_edits_since_offset_is_normalised() {
        let fx = test_state();
        three_edits(&fx);
        assert_eq!(
            ids_since(&fx.state.db, Some("2026-10-27T17:00:01+07:00")).unwrap(),
            vec!["e-3", "e-2"]
        );
    }

    /// Open the DB at a fresh path, optionally overwrite `explain_model`,
    /// reopen (every open re-runs the migrations) and read the value back.
    fn explain_model_after_reopen(seed: Option<&str>) -> Option<String> {
        let fx = tempfile::TempDir::new().expect("tempdir");
        let path = fx.path().join("db.sqlite");
        let db = Db::open(&path).expect("first open");
        if let Some(v) = seed {
            db.set_setting("explain_model", v).unwrap();
        }
        drop(db);
        let db = Db::open(&path).expect("second open");
        let v = db.get_setting("explain_model").unwrap();
        println!("explain_model after reopen (seed {seed:?}) = {v:?}");
        v
    }

    #[test]
    fn explain_model_fresh_db_is_opus_5_5() {
        assert_eq!(
            explain_model_after_reopen(None).as_deref(),
            Some("\"claude-opus-5-5\"")
        );
    }

    #[test]
    fn explain_model_old_default_moves_to_opus_5_5() {
        assert_eq!(
            explain_model_after_reopen(Some("\"claude-opus-4-8\"")).as_deref(),
            Some("\"claude-opus-5-5\"")
        );
    }

    #[test]
    fn explain_model_other_values_are_kept() {
        assert_eq!(
            explain_model_after_reopen(Some("\"claude-sonnet-5-5\"")).as_deref(),
            Some("\"claude-sonnet-5-5\"")
        );
    }

    #[test]
    fn explain_model_unquoted_old_value_is_not_matched() {
        assert_eq!(
            explain_model_after_reopen(Some("claude-opus-4-8")).as_deref(),
            Some("claude-opus-4-8")
        );
    }

    #[test]
    fn explain_model_is_stable_across_three_opens() {
        let fx = tempfile::TempDir::new().expect("tempdir");
        let path = fx.path().join("db.sqlite");
        for _ in 0..3 {
            drop(Db::open(&path).expect("open"));
        }
        let db = Db::open(&path).expect("open");
        assert_eq!(
            db.get_setting("explain_model").unwrap().as_deref(),
            Some("\"claude-opus-5-5\"")
        );
    }

    #[test]
    fn db_settings_get_set_roundtrip() {
        // `set_setting` performs an UPSERT keyed by `key`. After two writes to
        // the same key, `get_setting` must return the latest value.
        let fx = test_state();
        fx.state.db.set_setting("mode", "\"observer\"").unwrap();
        let v = fx.state.db.get_setting("mode").unwrap();
        assert_eq!(v.as_deref(), Some("\"observer\""));

        // Overwrite — UPSERT branch.
        fx.state.db.set_setting("mode", "\"gatekeeper\"").unwrap();
        let v2 = fx.state.db.get_setting("mode").unwrap();
        assert_eq!(v2.as_deref(), Some("\"gatekeeper\""));
    }

    /// Tests for migration 002 (knowledge base + practice + plan_comments +
    /// FTS5). Namespaced so `cargo test db::kb::...` matches the plan
    /// verification path.
    mod kb {
        use super::test_state;
        use rusqlite::params;

        /// TC-W1-T1a-1: Fresh DB — migration 002 creates all 5 tables and
        /// `kb_fts` is registered as an FTS5 virtual table.
        #[test]
        fn migration_creates_all_tables() {
            let fx = test_state();
            let c = fx.state.db.conn.lock();

            for table in [
                "kb_entries",
                "kb_fts",
                "practice_decks",
                "practice_cards",
                "plan_comments",
            ] {
                let found: Option<String> = c
                    .query_row(
                        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?1",
                        params![table],
                        |row| row.get(0),
                    )
                    .ok();
                assert_eq!(
                    found.as_deref(),
                    Some(table),
                    "table {table} must exist after migration 002"
                );
            }

            // kb_fts must be an fts5 virtual table — the CREATE VIRTUAL TABLE
            // sql is persisted verbatim in sqlite_master.sql.
            let sql: String = c
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE name = 'kb_fts'",
                    [],
                    |row| row.get(0),
                )
                .expect("kb_fts sql present");
            assert!(
                sql.to_lowercase().contains("using fts5"),
                "kb_fts must be an FTS5 virtual table, got: {sql}"
            );
        }

        /// TC-W1-T1a-2: Migration 002 is idempotent — running twice must not
        /// error and must not duplicate rows. `Db::open` applies migrations on
        /// every open, so opening the same on-disk DB twice exercises re-run.
        #[test]
        fn migration_runs_twice() {
            use crate::db::Db;

            let fx = tempfile::TempDir::new().expect("tempdir");
            let path = fx.path().join("db.sqlite");

            let db1 = Db::open(&path).expect("first open applies migration 002");
            drop(db1);

            // Re-opening must re-apply migration 002 without error. If any DDL
            // lacked IF NOT EXISTS this would panic here.
            let db2 = Db::open(&path).expect("second open re-applies migration 002 idempotently");
            let c = db2.conn.lock();

            // Cross-check: table still there, no duplicate schema rows.
            let count: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = 'kb_entries'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                count, 1,
                "kb_entries schema row must be unique after re-run"
            );
        }

        /// TC-W1-T1a-3: FTS5 MATCH returns the row whose title/body contains
        /// the search term. Confirms the FTS5 extension is compiled in
        /// (rusqlite `bundled-full` feature) and the standalone table works.
        #[test]
        fn fts5_match_returns_correct_row() {
            let fx = test_state();
            let c = fx.state.db.conn.lock();

            // Populate FTS5 directly — the knowledge feature used to sit on top of
            // this, but the schema-level guarantee is what this task owns.
            c.execute(
                "INSERT INTO kb_fts(rowid, title, body) VALUES (1, ?1, ?2)",
                params!["rust ownership", "borrow checker enforces lifetimes"],
            )
            .unwrap();
            c.execute(
                "INSERT INTO kb_fts(rowid, title, body) VALUES (2, ?1, ?2)",
                params!["sqlite basics", "wal journal mode is nice"],
            )
            .unwrap();
            c.execute(
                "INSERT INTO kb_fts(rowid, title, body) VALUES (3, ?1, ?2)",
                params!["fts5 primer", "tokenize unicode61 handles diacritics"],
            )
            .unwrap();

            let mut stmt = c
                .prepare("SELECT rowid FROM kb_fts WHERE kb_fts MATCH ?1")
                .expect("FTS5 MATCH must parse");
            let rows: Vec<i64> = stmt
                .query_map(params!["borrow"], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            assert_eq!(rows, vec![1], "only the 'borrow' row must match");
        }
    }

    /// Tests for migration 004 (session-history index and change labels).
    mod session_index {
        use crate::db::Db;
        use crate::test_support::test_state;
        use rusqlite::params;

        const TABLES: [&str; 3] = ["transcript_files", "tool_calls", "edit_labels"];

        fn table_rows(db: &Db, name: &str) -> i64 {
            db.conn
                .lock()
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![name],
                    |row| row.get(0),
                )
                .unwrap()
        }

        #[test]
        fn fresh_database_has_the_three_tables() {
            let fx = test_state();
            for t in TABLES {
                assert_eq!(table_rows(&fx.state.db, t), 1, "{t} must exist");
            }
        }

        #[test]
        fn opening_twice_keeps_one_copy_of_each_table() {
            let tmp = tempfile::TempDir::new().unwrap();
            let path = tmp.path().join("db.sqlite");
            drop(Db::open(&path).expect("first open"));
            let db = Db::open(&path).expect("second open re-applies 004 without error");
            for t in TABLES {
                assert_eq!(table_rows(&db, t), 1, "{t} must exist once");
            }
        }

        #[test]
        fn a_database_with_edits_keeps_its_rows_after_reopen() {
            let tmp = tempfile::TempDir::new().unwrap();
            let path = tmp.path().join("db.sqlite");
            let db = Db::open(&path).unwrap();
            db.conn
                .lock()
                .execute(
                    "INSERT INTO edits (id, tool, path, after_blob_sha, status, hook_phase, created_at)
                     VALUES ('e-1', 'Edit', '/p/a.rs', 'sha', 'pending', 'post', '2026-06-30T00:00:00Z')",
                    [],
                )
                .unwrap();
            drop(db);
            let db = Db::open(&path).unwrap();
            let n: i64 = db
                .conn
                .lock()
                .query_row("SELECT COUNT(*) FROM edits", [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1);
        }
    }

    mod labeled {
        use super::{make_edit, test_state};
        use crate::app::EditFilter;

        fn label(
            fx: &crate::test_support::TestState,
            id: &str,
            session: &str,
            decision: Option<&str>,
        ) {
            fx.state
                .db
                .conn
                .lock()
                .execute(
                    "INSERT INTO edit_labels (edit_id, source, session_id, tool_use_id, decision, matched_at)
                     VALUES (?1, 'claude', ?2, 't1', ?3, 0)",
                    rusqlite::params![id, session, decision],
                )
                .unwrap();
        }

        #[test]
        fn a_label_fills_the_missing_session_and_adds_source_and_decision() {
            let fx = test_state();
            let mut e = make_edit("e-1", "x", "/p/a.rs", "pending");
            e.session_id = None;
            fx.state.db.insert_edit(&e).unwrap();
            label(&fx, "e-1", "sess-9", Some("accept"));
            let rows = fx
                .state
                .db
                .list_edits_labeled(EditFilter::default())
                .unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].edit.session_id.as_deref(), Some("sess-9"));
            assert_eq!(rows[0].source.as_deref(), Some("claude"));
            assert_eq!(rows[0].decision.as_deref(), Some("accept"));
        }

        #[test]
        fn a_stored_session_wins_over_the_label() {
            let fx = test_state();
            fx.state.db.ensure_session("own", None).unwrap();
            fx.state
                .db
                .insert_edit(&make_edit("e-2", "own", "/p/b.rs", "pending"))
                .unwrap();
            label(&fx, "e-2", "sess-9", None);
            let rows = fx
                .state
                .db
                .list_edits_labeled(EditFilter::default())
                .unwrap();
            assert_eq!(rows[0].edit.session_id.as_deref(), Some("own"));
        }

        #[test]
        fn an_unmatched_change_has_no_source() {
            let fx = test_state();
            fx.state.db.ensure_session("s", None).unwrap();
            fx.state
                .db
                .insert_edit(&make_edit("e-3", "s", "/p/c.rs", "pending"))
                .unwrap();
            let rows = fx
                .state
                .db
                .list_edits_labeled(EditFilter::default())
                .unwrap();
            assert!(rows[0].source.is_none() && rows[0].decision.is_none());
        }

        #[test]
        fn the_labelled_list_serialises_flat() {
            let fx = test_state();
            fx.state.db.ensure_session("s", None).unwrap();
            fx.state
                .db
                .insert_edit(&make_edit("e-4", "s", "/p/d.rs", "pending"))
                .unwrap();
            let rows = fx
                .state
                .db
                .list_edits_labeled(EditFilter::default())
                .unwrap();
            let v = serde_json::to_value(&rows[0]).unwrap();
            assert_eq!(v["id"], "e-4");
            assert!(v.get("edit").is_none());
            assert!(v.get("source").is_some());
        }
    }

    #[test]
    fn db_project_crud_lifecycle() {
        // Insert → list → delete. `list_projects` orders by
        // `last_opened_at DESC NULLS LAST, added_at DESC` so a freshly-inserted
        // project with no last_opened_at should still appear.
        let fx = test_state();
        let p = Project {
            id: "p-1".to_string(),
            name: "demo".to_string(),
            path: "/tmp/proj".to_string(),
            color: None,
            added_at: "2026-06-30T00:00:00Z".to_string(),
            last_opened_at: None,
        };
        fx.state.db.insert_project(&p).unwrap();

        let listed = fx.state.db.list_projects().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "p-1");

        fx.state.db.delete_project("p-1").unwrap();
        let after = fx.state.db.list_projects().unwrap();
        assert!(after.is_empty(), "delete_project must remove the row");
    }
}
