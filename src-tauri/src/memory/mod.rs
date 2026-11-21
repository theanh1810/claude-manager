//! Memory, errors and mem0, read only (UC-002).
//!
//! Nothing in this module writes a memory file, an errors file or mem0. A
//! source file is opened only when `memory_list` returned its path in this
//! session (`OpenAllow`).

pub mod files;
pub mod mem0;

use crate::app::Project;
use crate::db::Db;
use mem0::{Mem0Error, ReasonKind};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Memory,
    Error,
}

/// Where an entry came from: a file with its start line, or a mem0 memory.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum Source {
    File { path: String, line: u32 },
    Mem0 { mem0_id: String, entity: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MemoryEntry {
    pub id: String,
    pub kind: Kind,
    pub project: Option<String>,
    pub source: Source,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Problem {
    pub path: String,
    pub error: String,
}

/// `unavailable` carries the reason kind and, for HTTP failures, the status
/// code; the screen renders the approved sentence for each kind.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Mem0Status {
    Available,
    Unavailable {
        reason: ReasonKind,
        status: Option<u16>,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MemoryList {
    pub entries: Vec<MemoryEntry>,
    pub mem0: Mem0Status,
    pub problems: Vec<Problem>,
}

/// The mem0 endpoint and per-request timeout; tests point it at a stub.
pub struct Mem0Config {
    pub base_url: String,
    pub timeout: Duration,
}

impl Default for Mem0Config {
    fn default() -> Self {
        Self {
            base_url: mem0::BASE_URL.to_string(),
            timeout: mem0::TIMEOUT,
        }
    }
}

/// Paths `memory_list` has returned; only these may be opened.
#[derive(Default)]
pub struct OpenAllow(Mutex<HashSet<String>>);

impl OpenAllow {
    fn allow(&self, path: &str) {
        self.0.lock().insert(path.to_string());
    }

    pub fn is_allowed(&self, path: &str) -> bool {
        self.0.lock().contains(path)
    }
}

/// All entries: project memory and errors of the registered projects, and,
/// when no project is selected, global memory and mem0.
pub async fn list(
    db: &Db,
    project: Option<&str>,
    mem0_key: Option<&str>,
    home: &Path,
    mem0_cfg: &Mem0Config,
    allow: &OpenAllow,
) -> MemoryList {
    let mut entries = Vec::new();
    let mut problems = Vec::new();
    // A database error is a problem to show, not "no projects": the local
    // scans below still run.
    let projects: Vec<Project> = match db.list_projects() {
        Ok(p) => p,
        Err(e) => {
            problems.push(Problem {
                path: "projects".to_string(),
                error: e.to_string(),
            });
            Vec::new()
        }
    };
    for p in projects
        .iter()
        .filter(|p| project.is_none_or(|sel| p.path == sel))
    {
        // File reads must not block the async runtime.
        let (path, name) = (p.path.clone(), p.name.clone());
        match tokio::task::spawn_blocking(move || files::scan_project(Path::new(&path), &name))
            .await
        {
            Ok(scan) => {
                entries.extend(scan.entries);
                problems.extend(scan.problems);
            }
            Err(e) => problems.push(Problem {
                path: p.path.clone(),
                error: e.to_string(),
            }),
        }
    }
    let mut status = Mem0Status::Available;
    if project.is_none() {
        let home_owned = home.to_path_buf();
        match tokio::task::spawn_blocking(move || files::scan_global(&home_owned)).await {
            Ok(scan) => {
                entries.extend(scan.entries);
                problems.extend(scan.problems);
            }
            Err(e) => problems.push(Problem {
                path: "global".to_string(),
                error: e.to_string(),
            }),
        }
        match mem0::fetch(&mem0_cfg.base_url, mem0_key, mem0_cfg.timeout).await {
            Ok(items) => entries.extend(items.into_iter().map(|m| MemoryEntry {
                id: format!("mem0:{}", m.id),
                kind: Kind::Memory,
                project: None,
                source: Source::Mem0 {
                    mem0_id: m.id,
                    entity: format!("{} {}", m.entity_type, m.entity_name),
                },
                text: m.text,
            })),
            Err(Mem0Error { kind, status: code }) => {
                status = Mem0Status::Unavailable {
                    reason: kind,
                    status: code,
                }
            }
        }
    }
    for e in &entries {
        if let Source::File { path, .. } = &e.source {
            allow.allow(path);
        }
    }
    MemoryList {
        entries,
        mem0: status,
        problems,
    }
}

/// Open a listed source file with `open`; any other path is refused. A listed path may be a link, so `open`
/// gets the real path, and only when that is a regular `.md`, `.yaml` or `.yml` file: a link must not hand a
/// script to the system's default handler.
pub fn open_file<F: FnOnce(&str) -> Result<(), String>>(
    allow: &OpenAllow,
    path: &str,
    open: F,
) -> Result<(), String> {
    if !allow.is_allowed(path) {
        return Err("path is not a listed source".to_string());
    }
    let refused = || "Chỉ mở được file .md, .yaml hoặc .yml.".to_string();
    let real = Path::new(path)
        .canonicalize()
        .map_err(crate::store::mask_err)?;
    let text_ext = real
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ["md", "yaml", "yml"].contains(&e.to_ascii_lowercase().as_str()));
    if !text_ext
        || !std::fs::metadata(&real)
            .map_err(crate::store::mask_err)?
            .is_file()
    {
        return Err(refused());
    }
    open(&real.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use tempfile::TempDir;

    fn project(db: &Db, dir: &Path) {
        db.insert_project(&Project {
            id: "p1".into(),
            name: "demo".into(),
            path: dir.to_string_lossy().to_string(),
            color: None,
            added_at: "2026-10-01T00:00:00Z".into(),
            last_opened_at: None,
        })
        .unwrap();
    }

    fn seed(dir: &Path) {
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(
            dir.join(".claude/MEMORY.md"),
            "# Mem\n\n- deploy with pnpm\n- never force push\n",
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("openspec/changes/x")).unwrap();
        std::fs::write(
            dir.join("openspec/changes/x/errors.yaml"),
            "errors:\n  - round: 1\n    entries:\n      - source: reviewer\n        text: |\n          flaky test\n",
        )
        .unwrap();
    }

    fn dead_mem0() -> Mem0Config {
        Mem0Config {
            base_url: "http://127.0.0.1:1".to_string(),
            timeout: Duration::from_millis(300),
        }
    }

    /// A stub answering two requests: the entity list, then the memories.
    fn stub(entities: &'static str, code: u16) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        std::thread::spawn(move || {
            for i in 0..2 {
                if let Ok((mut s, _)) = l.accept() {
                    let mut buf = [0u8; 4096];
                    let _ = s.read(&mut buf);
                    let b = if i == 0 {
                        entities
                    } else {
                        r#"{"results":[{"id":"m1","memory":"from mem0"}],"next":null}"#
                    };
                    let _ = write!(
                        s,
                        "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{b}",
                        b.len()
                    );
                }
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn files_of_a_registered_project_are_listed_with_path_and_line() {
        let fx = test_state();
        let dir = TempDir::new().unwrap();
        seed(dir.path());
        project(&fx.state.db, dir.path());
        let home = TempDir::new().unwrap();
        let list = list(
            &fx.state.db,
            None,
            None,
            home.path(),
            &dead_mem0(),
            &OpenAllow::default(),
        )
        .await;
        let kinds: Vec<Kind> = list.entries.iter().map(|e| e.kind).collect();
        assert!(kinds.contains(&Kind::Memory) && kinds.contains(&Kind::Error));
        for e in &list.entries {
            match &e.source {
                Source::File { path, line } => {
                    assert!(path.starts_with(dir.path().to_str().unwrap()) && *line >= 1)
                }
                Source::Mem0 { .. } => panic!("no mem0 entry expected"),
            }
            assert_eq!(e.project.as_deref(), Some("demo"));
        }
    }

    #[tokio::test]
    async fn entries_come_from_project_files_global_memory_and_mem0() {
        let fx = test_state();
        let dir = TempDir::new().unwrap();
        for (rel, text) in [
            (".claude/MEMORY.md", "- project rule\n"),
            (
                "openspec/changes/demo/errors.yaml",
                "errors:\n  - round: 1\n    verdict: red\n    entries: []\n",
            ),
            (
                "openspec/changes/archive/2026-01-01-old/errors.yaml",
                "errors:\n  - round: 1\n    verdict: green\n    entries: []\n",
            ),
        ] {
            let p = dir.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        }
        project(&fx.state.db, dir.path());
        let home = TempDir::new().unwrap();
        let c = home.path().join(".claude");
        std::fs::create_dir_all(c.join("memory")).unwrap();
        std::fs::write(c.join("memory/g.md"), "- global rule\n").unwrap();
        std::fs::create_dir_all(c.join("projects/-p/memory")).unwrap();
        std::fs::write(c.join("projects/-p/memory/m.md"), "- per project memory\n").unwrap();
        let cfg = Mem0Config {
            base_url: stub(
                r#"{"results":[{"id":"e1","name":"u1","type":"user"}],"next":null}"#,
                200,
            ),
            timeout: Duration::from_secs(2),
        };
        let list = list(
            &fx.state.db,
            None,
            Some("k"),
            home.path(),
            &cfg,
            &OpenAllow::default(),
        )
        .await;
        let ids: Vec<&str> = list.entries.iter().map(|e| e.id.as_str()).collect();
        let has = |part: &str| ids.iter().any(|i| i.contains(part));
        assert!(has(".claude/MEMORY.md"));
        assert!(has("openspec/changes/demo/errors.yaml"));
        assert!(has("openspec/changes/archive/2026-01-01-old/errors.yaml"));
        assert!(has("memory/g.md") && has("-p/memory/m.md"));
        assert!(ids.contains(&"mem0:m1"));
        assert!(list.problems.is_empty());
    }

    #[tokio::test]
    async fn a_selected_project_hides_global_and_mem0_entries() {
        let fx = test_state();
        let dir = TempDir::new().unwrap();
        seed(dir.path());
        project(&fx.state.db, dir.path());
        let home = TempDir::new().unwrap();
        std::fs::create_dir_all(home.path().join(".claude/memory")).unwrap();
        std::fs::write(home.path().join(".claude/memory/g.md"), "- global rule\n").unwrap();
        let sel = dir.path().to_string_lossy().to_string();
        let list = list(
            &fx.state.db,
            Some(&sel),
            Some("k"),
            home.path(),
            &dead_mem0(),
            &OpenAllow::default(),
        )
        .await;
        assert!(!list.entries.is_empty());
        assert!(list
            .entries
            .iter()
            .all(|e| e.project.as_deref() == Some("demo")));
        assert_eq!(list.mem0, Mem0Status::Available);
    }

    #[tokio::test]
    async fn a_database_error_is_a_problem_entry_and_the_local_scan_still_runs() {
        let fx = test_state();
        fx.state
            .db
            .conn
            .lock()
            .execute("DROP TABLE projects", [])
            .unwrap();
        let home = TempDir::new().unwrap();
        std::fs::create_dir_all(home.path().join(".claude/memory")).unwrap();
        std::fs::write(home.path().join(".claude/memory/g.md"), "- global rule\n").unwrap();
        let list = list(
            &fx.state.db,
            None,
            None,
            home.path(),
            &dead_mem0(),
            &OpenAllow::default(),
        )
        .await;
        assert!(list
            .problems
            .iter()
            .any(|p| p.path == "projects" && !p.error.is_empty()));
        assert!(list.entries.iter().any(|e| e.text.contains("global rule")));
    }

    #[tokio::test]
    async fn a_project_with_neither_file_gives_an_empty_list() {
        let fx = test_state();
        let dir = TempDir::new().unwrap();
        project(&fx.state.db, dir.path());
        let home = TempDir::new().unwrap();
        let sel = dir.path().to_string_lossy().to_string();
        let list = list(
            &fx.state.db,
            Some(&sel),
            None,
            home.path(),
            &dead_mem0(),
            &OpenAllow::default(),
        )
        .await;
        assert!(list.entries.is_empty() && list.problems.is_empty());
    }

    #[tokio::test]
    async fn no_key_marks_mem0_unavailable_and_local_entries_stay() {
        let fx = test_state();
        let dir = TempDir::new().unwrap();
        seed(dir.path());
        project(&fx.state.db, dir.path());
        let home = TempDir::new().unwrap();
        let list = list(
            &fx.state.db,
            None,
            None,
            home.path(),
            &dead_mem0(),
            &OpenAllow::default(),
        )
        .await;
        assert_eq!(
            list.mem0,
            Mem0Status::Unavailable {
                reason: ReasonKind::NoKey,
                status: None
            }
        );
        assert!(!list.entries.is_empty());
    }

    #[tokio::test]
    async fn a_server_error_marks_mem0_unavailable_with_the_status() {
        let fx = test_state();
        let dir = TempDir::new().unwrap();
        seed(dir.path());
        project(&fx.state.db, dir.path());
        let home = TempDir::new().unwrap();
        let cfg = Mem0Config {
            base_url: stub("{}", 500),
            timeout: Duration::from_secs(2),
        };
        let list = list(
            &fx.state.db,
            None,
            Some("k"),
            home.path(),
            &cfg,
            &OpenAllow::default(),
        )
        .await;
        assert_eq!(
            list.mem0,
            Mem0Status::Unavailable {
                reason: ReasonKind::HttpOther,
                status: Some(500)
            }
        );
        assert!(!list.entries.is_empty());
    }

    #[tokio::test]
    async fn mem0_entries_name_their_entity_and_the_key_is_never_returned() {
        let fx = test_state();
        let home = TempDir::new().unwrap();
        let cfg = Mem0Config {
            base_url: stub(
                r#"{"results":[{"id":"e1","name":"u1","type":"user"}],"next":null}"#,
                200,
            ),
            timeout: Duration::from_secs(2),
        };
        let list = list(
            &fx.state.db,
            None,
            Some("SECRET-KEY-123"),
            home.path(),
            &cfg,
            &OpenAllow::default(),
        )
        .await;
        assert_eq!(list.mem0, Mem0Status::Available);
        let hit = list
            .entries
            .iter()
            .find(|e| e.id == "mem0:m1")
            .expect("mem0 entry");
        assert_eq!(
            hit.source,
            Source::Mem0 {
                mem0_id: "m1".into(),
                entity: "user u1".into()
            }
        );
        assert!(!serde_json::to_string(&list)
            .unwrap()
            .contains("SECRET-KEY-123"));
    }

    #[test]
    fn only_a_listed_path_can_be_opened() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("MEMORY.md");
        std::fs::write(&file, "- rule\n").unwrap();
        let listed = file.to_string_lossy().to_string();
        let allow = OpenAllow::default();
        allow.allow(&listed);
        let mut opened = Vec::new();
        assert!(open_file(&allow, &listed, |p| {
            opened.push(p.to_string());
            Ok(())
        })
        .is_ok());
        assert_eq!(
            opened,
            vec![file.canonicalize().unwrap().to_string_lossy().to_string()]
        );
        for bad in ["/etc/passwd", "/p/.claude/../../etc/passwd", "../x"] {
            assert!(open_file(&allow, bad, |_| panic!("must not open {bad}")).is_err());
        }
    }

    /// Lists `link` (a path inside `dir`) and returns what `open_file` handed to the opener.
    #[cfg(unix)]
    fn open_listed(link: &Path) -> Result<String, String> {
        let allow = OpenAllow::default();
        let listed = link.to_string_lossy().to_string();
        allow.allow(&listed);
        let mut got = None;
        open_file(&allow, &listed, |p| {
            got = Some(p.to_string());
            Ok(())
        })
        .map(|()| got.expect("opener called"))
    }

    #[cfg(unix)]
    #[test]
    fn a_listed_memory_file_linked_to_a_script_is_not_opened() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("tools")).unwrap();
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        std::fs::write(dir.path().join("tools/run.command"), "echo hi\n").unwrap();
        let link = dir.path().join(".claude/MEMORY.md");
        std::os::unix::fs::symlink("../tools/run.command", &link).unwrap();
        let allow = OpenAllow::default();
        let listed = link.to_string_lossy().to_string();
        allow.allow(&listed);
        let err = open_file(&allow, &listed, |_| panic!("must not open a script")).unwrap_err();
        assert_eq!(err, "Chỉ mở được file .md, .yaml hoặc .yml.");
    }

    #[cfg(unix)]
    #[test]
    fn a_listed_link_to_a_markdown_file_opens_its_real_path() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("notes")).unwrap();
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        std::fs::write(dir.path().join("notes/real.md"), "- a\n").unwrap();
        let link = dir.path().join(".claude/MEMORY.md");
        std::os::unix::fs::symlink("../notes/real.md", &link).unwrap();
        let real = dir.path().join("notes/real.md").canonicalize().unwrap();
        assert_eq!(open_listed(&link).unwrap(), real.to_string_lossy());
    }

    #[cfg(unix)]
    #[test]
    fn a_listed_regular_markdown_or_yaml_file_opens() {
        let dir = TempDir::new().unwrap();
        for name in ["a.md", "b.YAML", "c.yml"] {
            let p = dir.path().join(name);
            std::fs::write(&p, "x: 1\n").unwrap();
            assert_eq!(
                open_listed(&p).unwrap(),
                p.canonicalize().unwrap().to_string_lossy(),
                "{name}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_listed_folder_named_like_markdown_is_not_opened() {
        let dir = TempDir::new().unwrap();
        let folder = dir.path().join("x.md");
        std::fs::create_dir_all(&folder).unwrap();
        let allow = OpenAllow::default();
        let listed = folder.to_string_lossy().to_string();
        allow.allow(&listed);
        assert!(open_file(&allow, &listed, |_| panic!("must not open a folder")).is_err());
    }
}
