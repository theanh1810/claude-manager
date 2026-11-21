//! Session-history index and change labelling (UC-001, UC-004).
//!
//! `index` reads Claude Code transcripts incrementally into `tool_calls`,
//! `labels` matches recorded changes to those calls, and this file holds the
//! commands and the session list. Nothing here returns conversation text.

pub mod index;
pub mod labels;

use crate::app::AppState;
use crate::db::Db;
use crate::store::mask_err;
use index::IndexStats;
use rusqlite::params;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, State};

/// One session: the facts of its transcript file and two counts, nothing else.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SessionSummary {
    pub id: String,
    pub project_dir: Option<String>,
    pub project_folder: String,
    pub size: i64,
    pub created: i64,
    pub modified: i64,
    pub change_count: i64,
    pub reject_count: i64,
}

#[derive(Clone, Serialize)]
struct Progress {
    done: u64,
    total: u64,
}

/// `~/.claude/projects`, where Claude Code keeps one folder per project.
pub fn claude_projects_dir() -> Option<PathBuf> {
    directories::UserDirs::new().map(|d| d.home_dir().join(".claude").join("projects"))
}

fn secs(t: std::time::SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

/// The sessions of the index, newest first, with the number of Claude calls
/// and of rejected calls. A subagent transcript is counted into its parent
/// session and is not a session of its own.
pub fn list_sessions(db: &Db, project: Option<&str>) -> anyhow::Result<Vec<SessionSummary>> {
    let c = db.conn.lock();
    let mut stmt = c.prepare(
        "SELECT t.session_id, t.project_dir, t.path, t.size, t.mtime,
                COALESCE(k.calls, 0), COALESCE(k.rejects, 0)
         FROM transcript_files t
         LEFT JOIN (SELECT session_id, COUNT(*) AS calls,
                           SUM(CASE WHEN decision = 'reject' THEN 1 ELSE 0 END) AS rejects
                    FROM tool_calls GROUP BY session_id) k ON k.session_id = t.session_id
         WHERE (?1 IS NULL OR t.project_dir = ?1)
         ORDER BY t.mtime DESC",
    )?;
    let rows = stmt.query_map(params![project], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, i64>(6)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, project_dir, path, size, mtime, changes, rejects) = row?;
        let p = Path::new(&path);
        if p.file_stem().and_then(|s| s.to_str()) != Some(id.as_str()) {
            continue;
        }
        let folder = p
            .parent()
            .and_then(|d| d.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let created = std::fs::metadata(p)
            .and_then(|m| m.created())
            .ok()
            .and_then(secs)
            .unwrap_or(mtime);
        out.push(SessionSummary {
            id,
            project_dir,
            project_folder: folder,
            size,
            created,
            modified: mtime,
            change_count: changes,
            reject_count: rejects,
        });
    }
    Ok(out)
}

/// The transcript file of one session and its same-stem folder, for the Trash.
pub fn session_path(db: &Db, id: &str) -> Result<Vec<PathBuf>, String> {
    let c = db.conn.lock();
    let mut stmt = c
        .prepare("SELECT path FROM transcript_files WHERE session_id = ?1")
        .map_err(|e| e.to_string())?;
    let paths: Vec<String> = stmt
        .query_map(params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    let main = paths
        .iter()
        .map(PathBuf::from)
        .find(|p| p.file_stem().and_then(|s| s.to_str()) == Some(id))
        .ok_or_else(|| format!("unknown session {id}"))?;
    let mut out = vec![main.clone()];
    let dir = main.with_extension("");
    if dir.is_dir() {
        out.push(dir);
    }
    Ok(out)
}

/// Read the new transcript bytes, then label recorded changes. Runs off the
/// UI thread and reports bytes read so far on `sessions-index-progress`.
#[tauri::command]
pub async fn sessions_refresh(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<IndexStats, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || -> anyhow::Result<IndexStats> {
        let Some(root) = claude_projects_dir() else {
            return Ok(IndexStats::default());
        };
        let projects = db.list_projects()?;
        index::refresh(&db, &root, &projects, |done, total| {
            let _ = app.emit("sessions-index-progress", Progress { done, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(mask_err)
}

#[tauri::command]
pub fn sessions_list(
    project: Option<String>,
    state: State<AppState>,
) -> Result<Vec<SessionSummary>, String> {
    list_sessions(&state.db, project.as_deref()).map_err(mask_err)
}

#[cfg(test)]
pub(crate) mod fixtures {
    //! Transcript lines shaped like Claude Code's, with marker text in every
    //! field the index must never keep.
    use serde_json::json;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    pub fn call_line(id: &str, tool: &str, path: &str, ts: &str) -> String {
        json!({
            "type": "assistant", "timestamp": ts, "sessionId": "ignored",
            "message": {"role": "assistant", "content": [
                {"type": "text", "text": "SECRET-ANSWER"},
                {"type": "tool_use", "id": id, "name": tool,
                 "input": {"file_path": path, "old_string": "SECRET-CODE", "new_string": "x"}}
            ]}
        })
        .to_string()
    }

    pub fn decision_line(id: &str, decision: &str, ts: &str) -> String {
        json!({
            "type": "user", "timestamp": ts,
            "permissionDecision": {"decision": decision, "source": "config"},
            "message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": id, "content": "SECRET-OUTPUT"}
            ]}
        })
        .to_string()
    }

    pub fn prompt_line(ts: &str) -> String {
        json!({
            "type": "user", "timestamp": ts,
            "message": {"role": "user", "content": "SECRET-PROMPT"}
        })
        .to_string()
    }

    pub fn write_transcript(root: &Path, folder: &str, session: &str, lines: &[String]) -> PathBuf {
        let dir = root.join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{session}.jsonl"));
        let mut f = std::fs::File::create(&path).unwrap();
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
        path
    }

    pub fn append_lines(path: &Path, lines: &[String]) -> usize {
        let mut f = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        let mut n = 0;
        for l in lines {
            writeln!(f, "{l}").unwrap();
            n += l.len() + 1;
        }
        n
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use crate::test_support::test_state;
    use tempfile::TempDir;

    fn seeded() -> (crate::test_support::TestState, TempDir) {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        write_transcript(
            root.path(),
            "-p",
            "s1",
            &[
                prompt_line("2026-10-01T10:00:00Z"),
                call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:00:01Z"),
                decision_line("t1", "accept", "2026-10-01T10:00:02Z"),
                call_line("t2", "Write", "/p/b.rs", "2026-10-01T10:00:03Z"),
                decision_line("t2", "reject", "2026-10-01T10:00:04Z"),
                call_line("t3", "NotebookEdit", "/p/c.ipynb", "2026-10-01T10:00:05Z"),
            ],
        );
        index::refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        (fx, root)
    }

    #[test]
    fn a_session_lists_its_change_and_rejection_counts() {
        let (fx, _root) = seeded();
        let list = list_sessions(&fx.state.db, None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "s1");
        assert_eq!(list[0].change_count, 3);
        assert_eq!(list[0].reject_count, 1);
        assert!(list[0].size > 0 && list[0].modified > 0);
    }

    #[test]
    fn the_session_list_carries_no_conversation_text() {
        let (fx, _root) = seeded();
        let json = serde_json::to_string(&list_sessions(&fx.state.db, None).unwrap()).unwrap();
        for marker in [
            "SECRET-PROMPT",
            "SECRET-ANSWER",
            "SECRET-OUTPUT",
            "SECRET-CODE",
        ] {
            assert!(
                !json.contains(marker),
                "{marker} leaked into the session list"
            );
        }
    }

    #[test]
    fn the_project_filter_keeps_only_that_project() {
        let (fx, _root) = seeded();
        assert!(list_sessions(&fx.state.db, Some("/nowhere"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn session_path_returns_the_transcript_and_its_folder() {
        let (fx, root) = seeded();
        std::fs::create_dir_all(root.path().join("-p").join("s1").join("subagents")).unwrap();
        let paths = session_path(&fx.state.db, "s1").unwrap();
        assert_eq!(paths[0], root.path().join("-p").join("s1.jsonl"));
        assert_eq!(paths[1], root.path().join("-p").join("s1"));
        assert!(session_path(&fx.state.db, "nope").is_err());
    }
}
