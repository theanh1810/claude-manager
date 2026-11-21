//! Label recorded changes with the Claude call that made them.
//!
//! A change is "claude" when an Edit, Write or NotebookEdit call on the same
//! absolute path lies within `MATCH_WINDOW_SECS` of the change time; the
//! nearest call wins. Anything else is "unknown". Labels are stored when the
//! change is matched, so moving a transcript to the Trash does not erase them.

use crate::db::Db;
use anyhow::Result;
use rusqlite::params;
use std::collections::HashMap;

/// How far apart, in seconds, a change and a call may be and still match.
pub const MATCH_WINDOW_SECS: i64 = 10;

#[derive(Debug, Clone)]
struct Call {
    ts: i64,
    tool_use_id: String,
    session_id: String,
    decision: Option<String>,
}

/// The call nearest to `t` inside the window, found by binary search over
/// calls sorted by time. On a tie the earlier call wins.
fn nearest(calls: &[Call], t: i64) -> Option<&Call> {
    let i = calls.partition_point(|c| c.ts < t);
    let before = i.checked_sub(1).map(|j| &calls[j]);
    let after = calls.get(i);
    let best = match (before, after) {
        (Some(b), Some(a)) => {
            if t - b.ts <= a.ts - t {
                b
            } else {
                a
            }
        }
        (Some(b), None) => b,
        (None, Some(a)) => a,
        (None, None) => return None,
    };
    ((best.ts - t).abs() <= MATCH_WINDOW_SECS).then_some(best)
}

/// Label every recorded change that has no label yet, and retry the ones
/// labelled `unknown` (their call may have been indexed since); returns how
/// many labels were written or upgraded. A `claude` label is never downgraded.
/// Also fills the decision of earlier labels once its record is indexed.
pub fn label_unlabelled(db: &Db) -> Result<usize> {
    let c = db.conn.lock();
    let pending: Vec<(String, String, String)> = {
        let mut stmt = c.prepare(
            "SELECT e.id, e.path, e.created_at FROM edits e
             LEFT JOIN edit_labels l ON l.edit_id = e.id
             WHERE l.edit_id IS NULL OR l.source = 'unknown'",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };

    let mut by_path: HashMap<String, Vec<Call>> = HashMap::new();
    {
        let mut q = c.prepare(
            "SELECT tool_use_id, session_id, ts, decision FROM tool_calls
             WHERE file_path = ?1 ORDER BY ts",
        )?;
        for (_, path, _) in &pending {
            if by_path.contains_key(path) {
                continue;
            }
            let calls = q
                .query_map(params![path], |r| {
                    Ok(Call {
                        tool_use_id: r.get(0)?,
                        session_id: r.get(1)?,
                        ts: r.get(2)?,
                        decision: r.get(3)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            by_path.insert(path.clone(), calls);
        }
    }

    let now = chrono::Utc::now().timestamp();
    let tx = c.unchecked_transaction()?;
    let mut changed = 0;
    for (id, path, created_at) in &pending {
        let t = chrono::DateTime::parse_from_rfc3339(created_at)
            .ok()
            .map(|d| d.timestamp());
        let hit = t.and_then(|t| by_path.get(path).and_then(|calls| nearest(calls, t)));
        changed += match hit {
            // New label, or an `unknown` one upgraded; a `claude` row never matches the WHERE.
            Some(call) => tx.execute(
                "INSERT INTO edit_labels
                     (edit_id, source, session_id, tool_use_id, decision, matched_at)
                 VALUES (?1, 'claude', ?2, ?3, ?4, ?5)
                 ON CONFLICT(edit_id) DO UPDATE SET
                     source = 'claude', session_id = excluded.session_id,
                     tool_use_id = excluded.tool_use_id, decision = excluded.decision,
                     matched_at = excluded.matched_at
                 WHERE edit_labels.source = 'unknown'",
                params![id, call.session_id, call.tool_use_id, call.decision, now],
            )?,
            None => tx.execute(
                "INSERT OR IGNORE INTO edit_labels (edit_id, source, matched_at)
                 VALUES (?1, 'unknown', ?2)",
                params![id, now],
            )?,
        };
    }
    tx.execute(
        "UPDATE edit_labels SET decision =
             (SELECT k.decision FROM tool_calls k WHERE k.tool_use_id = edit_labels.tool_use_id)
         WHERE source = 'claude' AND decision IS NULL
           AND EXISTS (SELECT 1 FROM tool_calls k
                       WHERE k.tool_use_id = edit_labels.tool_use_id AND k.decision IS NOT NULL)",
        [],
    )?;
    tx.commit()?;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;

    fn edit(db: &Db, id: &str, path: &str, created_at: &str) {
        db.conn
            .lock()
            .execute(
                "INSERT INTO edits (id, tool, path, after_blob_sha, status, hook_phase, created_at)
                 VALUES (?1, 'FS::Modify', ?2, 'sha', 'pending', 'post', ?3)",
                params![id, path, created_at],
            )
            .unwrap();
    }

    fn call(db: &Db, id: &str, session: &str, path: &str, ts: &str, decision: Option<&str>) {
        let ts = chrono::DateTime::parse_from_rfc3339(ts)
            .unwrap()
            .timestamp();
        db.conn
            .lock()
            .execute(
                "INSERT INTO tool_calls (tool_use_id, session_id, transcript_path, tool, file_path, ts, decision)
                 VALUES (?1, ?2, '/t.jsonl', 'Edit', ?3, ?4, ?5)",
                params![id, session, path, ts, decision],
            )
            .unwrap();
    }

    fn label_of(db: &Db, id: &str) -> (String, Option<String>, Option<String>) {
        db.conn
            .lock()
            .query_row(
                "SELECT source, session_id, decision FROM edit_labels WHERE edit_id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
    }

    #[test]
    fn an_edit_within_the_window_is_labelled_claude_with_its_decision() {
        let fx = test_state();
        call(
            &fx.state.db,
            "t1",
            "s1",
            "/p/a.rs",
            "2026-10-01T10:00:00Z",
            Some("accept"),
        );
        edit(&fx.state.db, "e-1", "/p/a.rs", "2026-10-01T10:00:05Z");
        assert_eq!(label_unlabelled(&fx.state.db).unwrap(), 1);
        assert_eq!(
            label_of(&fx.state.db, "e-1"),
            ("claude".into(), Some("s1".into()), Some("accept".into()))
        );
    }

    #[test]
    fn an_edit_with_no_call_is_unknown() {
        let fx = test_state();
        edit(&fx.state.db, "e-1", "/p/a.rs", "2026-10-01T10:00:05Z");
        label_unlabelled(&fx.state.db).unwrap();
        assert_eq!(label_of(&fx.state.db, "e-1").0, "unknown");
    }

    #[test]
    fn a_call_outside_the_window_or_on_another_path_does_not_match() {
        let fx = test_state();
        call(
            &fx.state.db,
            "t1",
            "s1",
            "/p/a.rs",
            "2026-10-01T10:00:00Z",
            None,
        );
        call(
            &fx.state.db,
            "t2",
            "s1",
            "/p/other.rs",
            "2026-10-01T10:00:20Z",
            None,
        );
        edit(&fx.state.db, "e-1", "/p/a.rs", "2026-10-01T10:00:20Z");
        label_unlabelled(&fx.state.db).unwrap();
        assert_eq!(label_of(&fx.state.db, "e-1").0, "unknown");
    }

    #[test]
    fn with_two_calls_on_one_file_the_nearest_wins() {
        let fx = test_state();
        call(
            &fx.state.db,
            "far",
            "s-far",
            "/p/a.rs",
            "2026-10-01T09:59:52Z",
            None,
        );
        call(
            &fx.state.db,
            "near",
            "s-near",
            "/p/a.rs",
            "2026-10-01T10:00:02Z",
            None,
        );
        edit(&fx.state.db, "e-1", "/p/a.rs", "2026-10-01T10:00:00Z");
        label_unlabelled(&fx.state.db).unwrap();
        assert_eq!(label_of(&fx.state.db, "e-1").1.as_deref(), Some("s-near"));
    }

    #[test]
    fn a_labelled_change_is_not_labelled_again_and_its_decision_is_backfilled() {
        let fx = test_state();
        call(
            &fx.state.db,
            "t1",
            "s1",
            "/p/a.rs",
            "2026-10-01T10:00:00Z",
            None,
        );
        edit(&fx.state.db, "e-1", "/p/a.rs", "2026-10-01T10:00:01Z");
        assert_eq!(label_unlabelled(&fx.state.db).unwrap(), 1);
        assert_eq!(label_of(&fx.state.db, "e-1").2, None);
        fx.state
            .db
            .conn
            .lock()
            .execute(
                "UPDATE tool_calls SET decision = 'accept' WHERE tool_use_id = 't1'",
                [],
            )
            .unwrap();
        assert_eq!(label_unlabelled(&fx.state.db).unwrap(), 0);
        assert_eq!(label_of(&fx.state.db, "e-1").2.as_deref(), Some("accept"));
    }

    #[test]
    fn nearest_prefers_the_earlier_call_on_a_tie() {
        let calls = vec![
            Call {
                ts: 90,
                tool_use_id: "a".into(),
                session_id: "s".into(),
                decision: None,
            },
            Call {
                ts: 110,
                tool_use_id: "b".into(),
                session_id: "s".into(),
                decision: None,
            },
        ];
        assert_eq!(nearest(&calls, 100).unwrap().tool_use_id, "a");
        assert!(nearest(&calls, 200).is_none());
    }
}
