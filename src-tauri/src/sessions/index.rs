//! Incremental reader of Claude Code session history.
//!
//! Per Edit, Write or NotebookEdit call only four facts are kept: tool name,
//! file path, time, and the permission decision joined by `tool_use_id`. Per
//! transcript file only its name, size, dates and the byte offset already read
//! are kept. No prompt, answer or tool output is stored, returned or logged.

use super::labels;
use crate::app::Project;
use crate::db::Db;
use anyhow::Result;
use parking_lot::Mutex;
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

/// One refresh at a time: two callers would read the same bytes twice.
static REFRESH_LOCK: Mutex<()> = Mutex::new(());

const TOOLS: [&str; 3] = ["Edit", "Write", "NotebookEdit"];

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct IndexStats {
    pub files_total: usize,
    pub files_read: usize,
    pub bytes_read: u64,
    pub malformed_lines: i64,
    pub labelled: usize,
}

/// `/Users/a/.claude` becomes `-Users-a--claude`: every `/` and `.` is `-`.
pub fn encode_project_path(path: &str) -> String {
    path.chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
enum Fact {
    Call {
        tool_use_id: String,
        tool: String,
        file_path: String,
        ts: i64,
    },
    Decision {
        tool_use_id: String,
        decision: String,
        source: Option<String>,
        denial_kind: Option<String>,
        /// When the answer was recorded: the moment the write was allowed.
        ts: Option<i64>,
    },
    /// A tool_result for a call, with no permission decision on its record.
    Result { tool_use_id: String, ts: i64 },
}

fn parse_ts(v: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(v.get("timestamp")?.as_str()?)
        .ok()
        .map(|d| d.timestamp())
}

/// The facts of one transcript line. Every other field is dropped here.
fn facts_of(v: &Value) -> Vec<Fact> {
    let mut out = Vec::new();
    let Some(content) = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    else {
        return out;
    };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("assistant") => {
            let Some(ts) = parse_ts(v) else { return out };
            for block in content {
                if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                    continue;
                }
                let Some(name) = block.get("name").and_then(|n| n.as_str()) else {
                    continue;
                };
                if !TOOLS.contains(&name) {
                    continue;
                }
                let input = block.get("input");
                let path = input
                    .and_then(|i| i.get("file_path").or_else(|| i.get("notebook_path")))
                    .and_then(|p| p.as_str());
                let id = block.get("id").and_then(|i| i.as_str());
                if let (Some(id), Some(path)) = (id, path) {
                    out.push(Fact::Call {
                        tool_use_id: id.to_string(),
                        tool: name.to_string(),
                        file_path: path.to_string(),
                        ts,
                    });
                }
            }
        }
        Some("user") => {
            let ts = parse_ts(v);
            let decision = v
                .get("permissionDecision")
                .and_then(|pd| pd.get("decision"))
                .and_then(|d| d.as_str());
            let source = v
                .get("permissionDecision")
                .and_then(|pd| pd.get("source"))
                .and_then(|s| s.as_str())
                .map(String::from);
            let denial = v
                .get("toolDenialKind")
                .and_then(|d| d.as_str())
                .map(String::from);
            for block in content {
                if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                    continue;
                }
                let Some(id) = block.get("tool_use_id").and_then(|i| i.as_str()) else {
                    continue;
                };
                match (decision, ts) {
                    (Some(d), _) => out.push(Fact::Decision {
                        tool_use_id: id.to_string(),
                        decision: d.to_string(),
                        source: source.clone(),
                        denial_kind: denial.clone(),
                        ts,
                    }),
                    (None, Some(ts)) => out.push(Fact::Result {
                        tool_use_id: id.to_string(),
                        ts,
                    }),
                    (None, None) => {}
                }
            }
        }
        _ => {}
    }
    out
}

struct Chunk {
    facts: Vec<Fact>,
    new_offset: u64,
    malformed: i64,
}

/// Read the complete lines after `from`. A last line without its newline is
/// still being written and is left for the next refresh.
fn read_chunk(path: &Path, from: u64) -> std::io::Result<Chunk> {
    let mut f = File::open(path)?;
    f.seek(SeekFrom::Start(from))?;
    let mut r = BufReader::new(f);
    let mut offset = from;
    let mut facts = Vec::new();
    let mut malformed = 0;
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = r.read_until(b'\n', &mut buf)?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break;
        }
        offset += n as u64;
        let line = &buf[..n - 1];
        if line.iter().all(|b| b.is_ascii_whitespace()) {
            continue;
        }
        match serde_json::from_slice::<Value>(line) {
            Ok(v) => facts.extend(facts_of(&v)),
            Err(_) => malformed += 1,
        }
    }
    Ok(Chunk {
        facts,
        new_offset: offset,
        malformed,
    })
}

struct Found {
    path: PathBuf,
    folder: String,
    session_id: String,
    size: u64,
    mtime: i64,
}

fn list_transcripts(root: &Path) -> Vec<Found> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root)
        .min_depth(2)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !entry.file_type().is_file() || p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(rel) = p.strip_prefix(root) else {
            continue;
        };
        let comps: Vec<String> = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect();
        if comps.len() < 2 {
            continue;
        }
        let session_id = if comps.len() == 2 {
            match p.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            }
        } else {
            comps[1].clone()
        };
        let Ok(meta) = entry.metadata() else { continue };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        out.push(Found {
            path: p.to_path_buf(),
            folder: comps[0].clone(),
            session_id,
            size: meta.len(),
            mtime,
        });
    }
    out
}

fn project_dir_of(folder: &str, projects: &[Project]) -> Option<String> {
    projects
        .iter()
        .find(|p| encode_project_path(&p.path) == folder)
        .map(|p| p.path.clone())
}

/// Index the bytes appended to every transcript since the last refresh, then
/// label the recorded changes. `progress(done, total)` counts bytes.
pub fn refresh<F: FnMut(u64, u64)>(
    db: &Db,
    root: &Path,
    projects: &[Project],
    mut progress: F,
) -> Result<IndexStats> {
    let _guard = REFRESH_LOCK.lock();
    let files = list_transcripts(root);
    let mut stats = IndexStats {
        files_total: files.len(),
        ..IndexStats::default()
    };

    let stored: HashMap<String, (i64, i64)> = {
        let c = db.conn.lock();
        let mut stmt =
            c.prepare("SELECT path, read_offset, malformed_lines FROM transcript_files")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?),
            ))
        })?;
        rows.collect::<rusqlite::Result<_>>()?
    };

    // Files that vanished: their calls go, their labels stay.
    let present: HashSet<String> = files
        .iter()
        .map(|f| f.path.to_string_lossy().to_string())
        .collect();
    {
        let c = db.conn.lock();
        let tx = c.unchecked_transaction()?;
        for path in stored.keys().filter(|p| !present.contains(*p)) {
            tx.execute(
                "DELETE FROM tool_calls WHERE transcript_path = ?1",
                params![path],
            )?;
            tx.execute(
                "DELETE FROM transcript_files WHERE path = ?1",
                params![path],
            )?;
        }
        for f in &files {
            let key = f.path.to_string_lossy().to_string();
            if stored.contains_key(&key) {
                tx.execute(
                    "UPDATE transcript_files SET project_dir = ?1 WHERE path = ?2",
                    params![project_dir_of(&f.folder, projects), key],
                )?;
            }
        }
        tx.commit()?;
    }

    // What has to be read: (file, start offset, previous malformed count).
    let mut todo: Vec<(&Found, u64, i64)> = Vec::new();
    for f in &files {
        let key = f.path.to_string_lossy().to_string();
        match stored.get(&key) {
            Some(&(off, bad)) if (off as u64) <= f.size => {
                if (off as u64) < f.size {
                    todo.push((f, off as u64, bad));
                }
            }
            // new file, or it shrank: read it from the start
            _ => todo.push((f, 0, 0)),
        }
    }
    let total: u64 = todo
        .iter()
        .map(|(f, from, _)| f.size - from.min(&f.size))
        .sum();
    let mut done = 0u64;
    progress(0, total);

    for (f, from, prev_bad) in todo {
        let key = f.path.to_string_lossy().to_string();
        let Ok(chunk) = read_chunk(&f.path, from) else {
            continue;
        };
        {
            let c = db.conn.lock();
            let tx = c.unchecked_transaction()?;
            if from == 0 {
                tx.execute(
                    "DELETE FROM tool_calls WHERE transcript_path = ?1",
                    params![key],
                )?;
            }
            for fact in &chunk.facts {
                match fact {
                    Fact::Call {
                        tool_use_id,
                        tool,
                        file_path,
                        ts,
                    } => {
                        tx.execute(
                            "INSERT OR IGNORE INTO tool_calls
                                 (tool_use_id, session_id, transcript_path, tool, file_path, ts)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                            params![tool_use_id, f.session_id, key, tool, file_path, ts],
                        )?;
                    }
                    Fact::Decision {
                        tool_use_id,
                        decision,
                        source,
                        denial_kind,
                        ts,
                    } => {
                        // The call is dated when the write was allowed: a prompt
                        // can sit for minutes between the tool_use and the change.
                        tx.execute(
                            "UPDATE tool_calls SET decision = ?2, decision_source = ?3, denial_kind = ?4,
                                 ts = MAX(ts, COALESCE(?5, ts))
                             WHERE tool_use_id = ?1",
                            params![tool_use_id, decision, source, denial_kind, ts],
                        )?;
                    }
                    Fact::Result { tool_use_id, ts } => {
                        tx.execute(
                            "UPDATE tool_calls SET ts = MAX(ts, ?2) WHERE tool_use_id = ?1",
                            params![tool_use_id, ts],
                        )?;
                    }
                }
            }
            tx.execute(
                "INSERT INTO transcript_files
                     (path, project_dir, session_id, size, mtime, read_offset, malformed_lines)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(path) DO UPDATE SET
                     project_dir = excluded.project_dir, session_id = excluded.session_id,
                     size = excluded.size, mtime = excluded.mtime,
                     read_offset = excluded.read_offset,
                     malformed_lines = excluded.malformed_lines",
                params![
                    key,
                    project_dir_of(&f.folder, projects),
                    f.session_id,
                    f.size as i64,
                    f.mtime,
                    chunk.new_offset as i64,
                    prev_bad + chunk.malformed
                ],
            )?;
            tx.commit()?;
        }
        stats.files_read += 1;
        stats.bytes_read += chunk.new_offset - from;
        done += f.size - from.min(f.size);
        progress(done, total);
    }

    stats.malformed_lines = {
        let c = db.conn.lock();
        c.query_row(
            "SELECT COALESCE(SUM(malformed_lines), 0) FROM transcript_files",
            [],
            |r| r.get(0),
        )?
    };
    stats.labelled = labels::label_unlabelled(db)?;
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::fixtures::*;
    use crate::test_support::test_state;
    use rusqlite::params;
    use tempfile::TempDir;

    fn count(db: &Db, table: &str) -> i64 {
        db.conn
            .lock()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    fn epoch(s: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(s).unwrap().timestamp()
    }

    #[test]
    fn one_allowed_edit_stores_the_four_facts() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        write_transcript(
            root.path(),
            "-p",
            "s1",
            &[
                call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:00:00Z"),
                decision_line("t1", "accept", "2026-10-01T10:00:01Z"),
            ],
        );
        let stats = refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        assert_eq!(stats.files_read, 1);
        let row: (String, String, String, i64, Option<String>) = fx
            .state
            .db
            .conn
            .lock()
            .query_row(
                "SELECT tool_use_id, tool, file_path, ts, decision FROM tool_calls",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            (
                "t1".into(),
                "Edit".into(),
                "/p/a.rs".into(),
                // the call is dated when the write was allowed (the decision record)
                epoch("2026-10-01T10:00:01Z"),
                Some("accept".into())
            )
        );
    }

    fn add_edit(db: &Db, id: &str, path: &str, created_at: &str) {
        db.conn
            .lock()
            .execute(
                "INSERT INTO edits (id, tool, path, after_blob_sha, status, hook_phase, created_at)
                 VALUES (?1, 'FS::Modify', ?2, 'sha', 'pending', 'post', ?3)",
                params![id, path, created_at],
            )
            .unwrap();
    }

    fn label(db: &Db, id: &str) -> (String, Option<String>, Option<String>) {
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
    fn a_call_allowed_after_a_long_prompt_still_labels_the_change_claude() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        write_transcript(
            root.path(),
            "-p",
            "s1",
            &[
                call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:00:00Z"),
                decision_line("t1", "accept", "2026-10-01T10:00:40Z"),
            ],
        );
        add_edit(&fx.state.db, "e1", "/p/a.rs", "2026-10-01T10:00:41Z");
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        assert_eq!(
            label(&fx.state.db, "e1"),
            ("claude".into(), Some("s1".into()), Some("accept".into()))
        );
    }

    #[test]
    fn an_unknown_label_upgrades_after_a_later_refresh_and_a_claude_label_never_downgrades() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        let path = write_transcript(
            root.path(),
            "-p",
            "s1",
            &[prompt_line("2026-10-01T09:00:00Z")],
        );
        add_edit(&fx.state.db, "e1", "/p/a.rs", "2026-10-01T10:05:00Z");
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        assert_eq!(label(&fx.state.db, "e1").0, "unknown");
        // the transcript catches up: the matching call is indexed afterwards
        append_lines(
            &path,
            &[
                call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:05:00Z"),
                decision_line("t1", "accept", "2026-10-01T10:05:02Z"),
            ],
        );
        let stats = refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        assert_eq!(stats.labelled, 1);
        assert_eq!(
            label(&fx.state.db, "e1"),
            ("claude".into(), Some("s1".into()), Some("accept".into()))
        );
        // the transcript is moved away: the claude label stays and is not downgraded
        std::fs::remove_file(&path).unwrap();
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        assert_eq!(label(&fx.state.db, "e1").0, "claude");
    }

    #[test]
    fn a_malformed_line_is_skipped_and_counted() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        write_transcript(
            root.path(),
            "-p",
            "s1",
            &[
                call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:00:00Z"),
                "{not json".to_string(),
                call_line("t2", "Write", "/p/b.rs", "2026-10-01T10:00:01Z"),
            ],
        );
        let stats = refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        assert_eq!(count(&fx.state.db, "tool_calls"), 2);
        assert_eq!(stats.malformed_lines, 1);
    }

    #[test]
    fn a_second_refresh_reads_only_the_appended_bytes() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        let path = write_transcript(
            root.path(),
            "-p",
            "s1",
            &[call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:00:00Z")],
        );
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        let added = append_lines(
            &path,
            &[call_line("t2", "Edit", "/p/b.rs", "2026-10-01T10:00:05Z")],
        );
        let stats = refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        assert_eq!(stats.bytes_read, added as u64);
        assert_eq!(count(&fx.state.db, "tool_calls"), 2);
        let again = refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        assert_eq!(again.files_read, 0);
    }

    #[test]
    fn a_shrunk_transcript_is_read_again_from_zero() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        write_transcript(
            root.path(),
            "-p",
            "s1",
            &[
                call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:00:00Z"),
                call_line("t2", "Edit", "/p/b.rs", "2026-10-01T10:00:01Z"),
                call_line("t3", "Edit", "/p/c.rs", "2026-10-01T10:00:02Z"),
            ],
        );
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        write_transcript(
            root.path(),
            "-p",
            "s1",
            &[call_line("t9", "Edit", "/p/z.rs", "2026-10-01T11:00:00Z")],
        );
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        let ids: Vec<String> = {
            let c = fx.state.db.conn.lock();
            let mut stmt = c.prepare("SELECT tool_use_id FROM tool_calls").unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        assert_eq!(ids, vec!["t9".to_string()]);
    }

    #[test]
    fn a_vanished_transcript_drops_its_calls_but_not_its_labels() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        let path = write_transcript(
            root.path(),
            "-p",
            "s1",
            &[call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:00:00Z")],
        );
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        fx.state
            .db
            .conn
            .lock()
            .execute(
                "INSERT INTO edit_labels (edit_id, source, matched_at) VALUES ('e-1', 'unknown', 0)",
                [],
            )
            .unwrap();
        std::fs::remove_file(path).unwrap();
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        assert_eq!(count(&fx.state.db, "tool_calls"), 0);
        assert_eq!(count(&fx.state.db, "transcript_files"), 0);
        assert_eq!(count(&fx.state.db, "edit_labels"), 1);
    }

    #[test]
    fn two_refreshes_at_once_leave_one_row_per_call() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        let lines: Vec<String> = (0..20)
            .map(|i| call_line(&format!("t{i}"), "Edit", "/p/a.rs", "2026-10-01T10:00:00Z"))
            .collect();
        write_transcript(root.path(), "-p", "s1", &lines);
        let db = &fx.state.db;
        std::thread::scope(|s| {
            for _ in 0..2 {
                s.spawn(|| {
                    refresh(db, root.path(), &[], |_, _| {}).unwrap();
                });
            }
        });
        assert_eq!(count(db, "tool_calls"), 20);
    }

    #[test]
    fn a_subagent_transcript_counts_into_its_parent_session() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        let dir = root.path().join("-p").join("s1").join("subagents");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("agent-1.jsonl"),
            format!(
                "{}\n",
                call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:00:00Z")
            ),
        )
        .unwrap();
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        let session: String = fx
            .state
            .db
            .conn
            .lock()
            .query_row("SELECT session_id FROM tool_calls", [], |r| r.get(0))
            .unwrap();
        assert_eq!(session, "s1");
    }

    #[test]
    fn the_project_is_the_registered_path_encoded_with_dashes() {
        assert_eq!(encode_project_path("/Users/a/.claude"), "-Users-a--claude");
        let fx = test_state();
        let root = TempDir::new().unwrap();
        write_transcript(
            root.path(),
            "-Users-a-Code-x",
            "s1",
            &[call_line(
                "t1",
                "Edit",
                "/Users/a/Code/x/a.rs",
                "2026-10-01T10:00:00Z",
            )],
        );
        let project = Project {
            id: "p1".into(),
            name: "x".into(),
            path: "/Users/a/Code/x".into(),
            color: None,
            added_at: "2026-10-01T00:00:00Z".into(),
            last_opened_at: None,
        };
        refresh(&fx.state.db, root.path(), &[project], |_, _| {}).unwrap();
        let dir: Option<String> = fx
            .state
            .db
            .conn
            .lock()
            .query_row("SELECT project_dir FROM transcript_files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(dir.as_deref(), Some("/Users/a/Code/x"));
    }

    #[test]
    fn no_prompt_answer_or_output_reaches_any_table() {
        let fx = test_state();
        let root = TempDir::new().unwrap();
        write_transcript(
            root.path(),
            "-p",
            "s1",
            &[
                prompt_line("2026-10-01T09:59:59Z"),
                call_line("t1", "Edit", "/p/a.rs", "2026-10-01T10:00:00Z"),
                decision_line("t1", "accept", "2026-10-01T10:00:01Z"),
            ],
        );
        refresh(&fx.state.db, root.path(), &[], |_, _| {}).unwrap();
        let c = fx.state.db.conn.lock();
        let tool_calls: String = c
            .query_row(
                "SELECT group_concat(tool_use_id || session_id || transcript_path || tool || file_path
                        || ts || COALESCE(decision, '') || COALESCE(decision_source, '')
                        || COALESCE(denial_kind, ''), '|') FROM tool_calls",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let files: String = c
            .query_row(
                "SELECT group_concat(path || COALESCE(project_dir, '') || session_id || size || mtime
                        || read_offset || malformed_lines, '|') FROM transcript_files",
                [],
                |r| r.get(0),
            )
            .unwrap();
        for marker in [
            "SECRET-PROMPT",
            "SECRET-ANSWER",
            "SECRET-OUTPUT",
            "SECRET-CODE",
        ] {
            assert!(
                !tool_calls.contains(marker) && !files.contains(marker),
                "{marker} stored"
            );
        }
    }
}
