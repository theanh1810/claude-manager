//! Memory and error files of a project and of ~/.claude, read only.

use super::{Kind, MemoryEntry, Problem, Source};
use crate::specs::errors::round_spans;
use crate::specs::plan_files::{read_opened, read_text};
use crate::specs::reader::open_inside;
use crate::store::mask_err;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct Scan {
    pub entries: Vec<MemoryEntry>,
    pub problems: Vec<Problem>,
}

fn entry(kind: Kind, path: &Path, line: usize, project: Option<&str>, text: String) -> MemoryEntry {
    let p = path.to_string_lossy().to_string();
    MemoryEntry {
        id: format!("file:{p}:{line}"),
        kind,
        project: project.map(String::from),
        source: Source::File {
            path: p,
            line: line as u32,
        },
        text,
    }
}

fn flush(
    cur: &mut Option<(usize, Vec<&str>)>,
    path: &Path,
    project: Option<&str>,
    out: &mut Vec<MemoryEntry>,
) {
    if let Some((start, mut ls)) = cur.take() {
        while ls.last().is_some_and(|l| l.trim().is_empty()) {
            ls.pop();
        }
        if ls.is_empty() || (ls.len() == 1 && ls[0].starts_with('#')) {
            return;
        }
        out.push(entry(Kind::Memory, path, start, project, ls.join("\n")));
    }
}

/// Entries of a markdown memory file: one per top-level list item, and one per
/// heading block that has prose. Front matter is skipped.
pub fn parse_markdown(path: &Path, text: &str, project: Option<&str>) -> Vec<MemoryEntry> {
    let lines: Vec<&str> = text.lines().collect();
    let mut first = 0;
    if lines.first().map(|l| l.trim_end()) == Some("---") {
        if let Some(end) = lines.iter().skip(1).position(|l| l.trim_end() == "---") {
            first = end + 2;
        }
    }
    let mut out = Vec::new();
    let mut cur: Option<(usize, Vec<&str>)> = None;
    for (idx, line) in lines.iter().enumerate().skip(first) {
        let n = idx + 1;
        if line.starts_with('#') || line.starts_with("- ") || line.starts_with("* ") {
            flush(&mut cur, path, project, &mut out);
            cur = Some((n, vec![*line]));
        } else if let Some((_, ls)) = cur.as_mut() {
            ls.push(*line);
        } else if !line.trim().is_empty() {
            cur = Some((n, vec![*line]));
        }
    }
    flush(&mut cur, path, project, &mut out);
    out
}

/// Entries of an errors file: one per round item of `errors:`, as written, at the line of its `- round:`.
/// A file without a round list is one entry; a blank file has none.
pub fn parse_errors(path: &Path, text: &str, project: Option<&str>) -> Vec<MemoryEntry> {
    let spans = round_spans(text);
    if spans.is_empty() {
        return if text.trim().is_empty() {
            Vec::new()
        } else {
            vec![entry(
                Kind::Error,
                path,
                1,
                project,
                text.trim_end().to_string(),
            )]
        };
    }
    let lines: Vec<&str> = text.lines().collect();
    spans
        .into_iter()
        .map(|r| {
            entry(
                Kind::Error,
                path,
                r.start + 1,
                project,
                lines[r].join("\n").trim_end().to_string(),
            )
        })
        .collect()
}

fn children(dir: &Path, ext: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()) == Some(ext))
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// Parses already-read `text` (or records why it could not be read) into `scan`.
fn take_text(
    scan: &mut Scan,
    kind: Kind,
    path: &Path,
    project: Option<&str>,
    text: Result<String, String>,
) {
    match text {
        Ok(text) => scan.entries.extend(if kind == Kind::Memory {
            parse_markdown(path, &text, project)
        } else {
            parse_errors(path, &text, project)
        }),
        Err(error) => scan.problems.push(Problem {
            path: path.to_string_lossy().to_string(),
            error,
        }),
    }
}

fn take(scan: &mut Scan, kind: Kind, path: &Path, project: Option<&str>) {
    take_text(scan, kind, path, project, read_text(path));
}

/// errors.yaml of openspec/changes/<change>/ and openspec/changes/archive/<folder>/, each list sorted by path;
/// the folder `archive` of openspec/changes is not a change. A missing folder yields nothing.
fn change_errors(dir: &Path) -> Vec<PathBuf> {
    let changes = dir.join("openspec/changes");
    let mut out = Vec::new();
    for parent in [changes.clone(), changes.join("archive")] {
        let Ok(rd) = std::fs::read_dir(&parent) else {
            continue;
        };
        let mut folders: Vec<PathBuf> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.file_name().and_then(|n| n.to_str()) != Some("archive"))
            .collect();
        folders.sort();
        out.extend(
            folders
                .into_iter()
                .map(|p| p.join("errors.yaml"))
                .filter(|p| p.is_file()),
        );
    }
    out
}

/// Memory files and error files of one project directory. A path that is not a regular file (missing,
/// a folder, `.claude` itself a file, a link loop) is skipped without a word, as before the hardening. Each
/// file is opened through `open_inside`, so one that a link takes out of the project is skipped too and the
/// file read is the file checked; a regular file that cannot be opened is a problem row; a real file reached
/// by several links is read once, under the first path.
pub fn scan_project(dir: &Path, name: &str) -> Scan {
    let mut scan = Scan {
        entries: Vec::new(),
        problems: Vec::new(),
    };
    let Ok(project) = dir.canonicalize() else {
        return scan;
    };
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut read = |scan: &mut Scan, kind: Kind, p: &Path| {
        if !p.is_file() {
            return;
        }
        match open_inside(p, &project) {
            Ok(Some(f)) => {
                if p.canonicalize().is_ok_and(|real| seen.insert(real)) {
                    take_text(scan, kind, p, Some(name), read_opened(&f).map_err(mask_err));
                }
            }
            Ok(None) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => scan.problems.push(Problem {
                path: p.to_string_lossy().to_string(),
                error: mask_err(e),
            }),
        }
    };
    for rel in [".claude/MEMORY.md", "docs/memory/PROJECT-MEM.md"] {
        read(&mut scan, Kind::Memory, &dir.join(rel));
    }
    let mut errors = change_errors(dir);
    errors.extend(children(&dir.join("docs/errors"), "yaml"));
    for p in &errors {
        read(&mut scan, Kind::Error, p);
    }
    scan
}

/// `~/.claude/memory/**/*.md` and `~/.claude/projects/*/memory/*.md`.
pub fn scan_global(home: &Path) -> Scan {
    let mut scan = Scan {
        entries: Vec::new(),
        problems: Vec::new(),
    };
    let claude = home.join(".claude");
    let mut files: Vec<PathBuf> = WalkDir::new(claude.join("memory"))
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|e| e.into_path())
        .filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("md"))
        .collect();
    if let Ok(rd) = std::fs::read_dir(claude.join("projects")) {
        let mut folders: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        folders.sort();
        for f in folders {
            files.extend(children(&f.join("memory"), "md"));
        }
    }
    files.sort();
    for p in files {
        take(&mut scan, Kind::Memory, &p, None);
    }
    scan
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn markdown_entries_carry_their_start_line_and_skip_front_matter() {
        let text = "---\nname: x\n---\n\n# Stack\n- Tauri 2\n- React\n  continued\n\n## Notes\nplain prose here\n";
        let e = parse_markdown(Path::new("/p/MEMORY.md"), text, Some("demo"));
        let lines: Vec<u32> = e
            .iter()
            .map(|e| match &e.source {
                Source::File { line, .. } => *line,
                _ => 0,
            })
            .collect();
        assert_eq!(lines, vec![6, 7, 10]);
        assert_eq!(e[1].text, "- React\n  continued");
        assert!(e.iter().all(|e| e.kind == Kind::Memory));
    }

    #[test]
    fn a_heading_with_no_prose_is_not_an_entry() {
        let e = parse_markdown(Path::new("/p/M.md"), "# Only a title\n\n", None);
        assert!(e.is_empty());
    }

    fn lines_of(e: &[MemoryEntry]) -> Vec<u32> {
        e.iter()
            .map(|e| match &e.source {
                Source::File { line, .. } => *line,
                _ => 0,
            })
            .collect()
    }

    #[test]
    fn two_rounds_give_two_entries_each_starting_at_its_round_line() {
        let text = "meta:\n  n: 1\nerrors:\n  - round: 1\n    entries:\n      - source: a\n        text: one\n      - source: b\n        text: two\n  - round: 2\n    entries:\n      - source: c\n        text: three\n";
        let e = parse_errors(Path::new("/p/errors.yaml"), text, Some("demo"));
        assert_eq!(lines_of(&e), vec![4, 10]);
        assert!(
            e[0].text.starts_with("  - round: 1")
                && e[0].text.contains("source: b")
                && !e[0].text.contains("round: 2")
        );
        assert!(e[1].text.starts_with("  - round: 2") && e[1].text.ends_with("text: three"));
        assert!(e.iter().all(|e| e.kind == Kind::Error));
    }

    #[test]
    fn a_round_item_inside_an_entry_text_does_not_split_the_round() {
        let text = "errors:\n  - round: 1\n    entries:\n      - source: a\n        text: |\n          - round: 9\n          - source: z\n";
        let e = parse_errors(Path::new("/p/errors.yaml"), text, None);
        assert_eq!(lines_of(&e), vec![2]);
        assert!(e[0].text.contains("- round: 9"));
    }

    #[test]
    fn a_file_without_a_round_list_is_one_entry_and_a_blank_file_has_none() {
        let legacy = "- source: a\n  text: one\n- source: b\n  text: two\n\n";
        let e = parse_errors(Path::new("/p/s1.yaml"), legacy, None);
        assert_eq!(lines_of(&e), vec![1]);
        assert_eq!(e[0].text, legacy.trim_end());
        assert!(parse_errors(Path::new("/p/s1.yaml"), "\n  \n", None).is_empty());
        assert!(parse_errors(Path::new("/p/s1.yaml"), "", None).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_project_scan_reads_memory_and_error_files_and_lists_an_unreadable_one() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        std::fs::write(dir.path().join(".claude/MEMORY.md"), "- one\n").unwrap();
        std::fs::create_dir_all(dir.path().join("openspec/changes/x")).unwrap();
        let bad = dir.path().join("openspec/changes/x/errors.yaml");
        std::fs::write(&bad, "- source: a\n").unwrap();
        std::fs::create_dir_all(dir.path().join("docs/errors")).unwrap();
        std::fs::write(
            dir.path().join("docs/errors/s1.yaml"),
            "- source: b\n  text: t\n",
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bad, std::fs::Permissions::from_mode(0o000)).unwrap();
        let scan = scan_project(dir.path(), "demo");
        std::fs::set_permissions(&bad, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(scan.entries.len(), 2);
        assert_eq!(scan.problems.len(), 1);
        assert!(scan.problems[0].path.ends_with("errors.yaml"));
    }

    #[test]
    fn global_memory_comes_from_the_home_memory_folder_and_project_memory_folders() {
        let home = TempDir::new().unwrap();
        let c = home.path().join(".claude");
        std::fs::create_dir_all(c.join("memory/global")).unwrap();
        std::fs::write(c.join("memory/MEMORY.md"), "- index\n").unwrap();
        std::fs::write(c.join("memory/MEMORY.md.bak"), "- old\n").unwrap();
        std::fs::write(c.join("memory/global/a.md"), "- g\n").unwrap();
        std::fs::create_dir_all(c.join("projects/-p/memory")).unwrap();
        std::fs::write(c.join("projects/-p/memory/m.md"), "- pm\n").unwrap();
        let scan = scan_global(home.path());
        assert_eq!(scan.entries.len(), 3);
        assert!(scan.entries.iter().all(|e| e.project.is_none()));
    }

    fn write_all(dir: &Path, files: &[&str]) {
        for rel in files {
            let p = dir.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, "- source: s\n  text: t\n").unwrap();
        }
    }

    fn error_paths(scan: &Scan) -> Vec<String> {
        scan.entries
            .iter()
            .filter_map(|e| match &e.source {
                Source::File { path, .. } => Some(path.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_project_scan_reads_errors_yaml_of_open_and_archived_changes() {
        let dir = TempDir::new().unwrap();
        write_all(
            dir.path(),
            &[
                "openspec/changes/b/errors.yaml",
                "openspec/changes/a/errors.yaml",
                "openspec/changes/archive/2026-01-01-old/errors.yaml",
            ],
        );
        let scan = scan_project(dir.path(), "demo");
        assert!(scan.problems.is_empty());
        let tails: Vec<String> = error_paths(&scan)
            .iter()
            .map(|p| {
                p.strip_prefix(dir.path().to_str().unwrap())
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(
            tails,
            vec![
                "/openspec/changes/a/errors.yaml",
                "/openspec/changes/b/errors.yaml",
                "/openspec/changes/archive/2026-01-01-old/errors.yaml",
            ]
        );
    }

    #[test]
    fn the_archive_folder_of_openspec_changes_is_not_a_change() {
        let dir = TempDir::new().unwrap();
        write_all(
            dir.path(),
            &[
                "openspec/changes/archive/errors.yaml",
                "openspec/changes/archive/x/notes/errors.yaml",
            ],
        );
        std::fs::write(dir.path().join("openspec/changes/README.md"), "# changes\n").unwrap();
        let scan = scan_project(dir.path(), "demo");
        assert!(scan.entries.is_empty() && scan.problems.is_empty());
    }

    #[test]
    fn error_files_without_a_change_folder_are_still_listed() {
        let dir = TempDir::new().unwrap();
        write_all(dir.path(), &["docs/errors/s1.yaml", "docs/errors/s2.yaml"]);
        std::fs::write(dir.path().join("docs/errors/notes.md"), "- not yaml\n").unwrap();
        let scan = scan_project(dir.path(), "demo");
        let paths = error_paths(&scan);
        assert_eq!(paths.len(), 2);
        assert!(
            paths[0].ends_with("docs/errors/s1.yaml") && paths[1].ends_with("docs/errors/s2.yaml")
        );
    }

    #[cfg(unix)]
    #[test]
    fn legacy_error_files_are_not_listed_and_not_opened() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new().unwrap();
        write_all(
            dir.path(),
            &[
                "docs/plan/old/errors.yaml",
                "docs/changes/old/errors.yaml",
                "docs/changes/archive/2026-01-01-b/errors.yaml",
            ],
        );
        let locked: Vec<PathBuf> = [
            "docs/plan/old",
            "docs/changes/old",
            "docs/changes/archive/2026-01-01-b",
        ]
        .iter()
        .map(|d| dir.path().join(d).join("errors.yaml"))
        .collect();
        for p in &locked {
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o000)).unwrap();
        }
        let scan = scan_project(dir.path(), "demo");
        for p in &locked {
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        assert!(
            scan.entries.is_empty(),
            "no error entry of the legacy folders"
        );
        assert!(scan.problems.is_empty(), "no problem line names them");
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_errors_yaml_under_openspec_changes_is_a_problem_and_the_others_are_still_listed(
    ) {
        let dir = TempDir::new().unwrap();
        let bad = dir.path().join("openspec/changes/a/errors.yaml");
        write_all(
            dir.path(),
            &[
                "openspec/changes/a/errors.yaml",
                "openspec/changes/b/errors.yaml",
            ],
        );
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bad, std::fs::Permissions::from_mode(0o000)).unwrap();
        let scan = scan_project(dir.path(), "demo");
        std::fs::set_permissions(&bad, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(scan.entries.len(), 1);
        assert_eq!(scan.problems.len(), 1);
        assert!(scan.problems[0]
            .path
            .ends_with("openspec/changes/a/errors.yaml"));
    }

    #[cfg(unix)]
    #[test]
    fn a_project_memory_or_errors_file_linked_out_of_the_project_is_not_read() {
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("secret.md");
        std::fs::write(&secret, "# Title\nSECRET\n").unwrap();
        let yaml = outside.path().join("secret.yaml");
        std::fs::write(&yaml, "- id: SECRET\n").unwrap();
        let d = TempDir::new().unwrap();
        let link = |rel: &str, to: &Path| {
            let p = d.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::os::unix::fs::symlink(to, p).unwrap();
        };
        link(".claude/MEMORY.md", &secret);
        link("docs/memory/PROJECT-MEM.md", &secret);
        link("openspec/changes/demo/errors.yaml", &yaml);
        link("docs/errors/e.yaml", &yaml);
        let scan = scan_project(d.path(), "demo");
        assert!(scan.entries.is_empty(), "{} entries", scan.entries.len());
        assert!(
            scan.problems.is_empty(),
            "{:?}",
            scan.problems.iter().map(|p| &p.path).collect::<Vec<_>>()
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_project_memory_file_linked_inside_the_project_is_still_read() {
        let d = TempDir::new().unwrap();
        std::fs::create_dir_all(d.path().join(".claude")).unwrap();
        std::fs::write(d.path().join("real.md"), "# Title\nkept text\n").unwrap();
        std::os::unix::fs::symlink(d.path().join("real.md"), d.path().join(".claude/MEMORY.md"))
            .unwrap();
        let scan = scan_project(d.path(), "demo");
        assert_eq!(scan.entries.len(), 1);
        assert!(scan.entries[0].text.contains("kept text"));
    }
    #[cfg(unix)]
    #[test]
    fn a_claude_path_that_is_a_file_or_a_link_loop_is_skipped_without_a_problem() {
        let a = TempDir::new().unwrap();
        std::fs::write(a.path().join(".claude"), "not a folder").unwrap();
        let b = TempDir::new().unwrap();
        std::fs::create_dir_all(b.path().join(".claude")).unwrap();
        std::os::unix::fs::symlink("MEMORY.md", b.path().join(".claude/MEMORY.md")).unwrap();
        for (d, what) in [(&a, "a file"), (&b, "a link to itself")] {
            let scan = scan_project(d.path(), "demo");
            assert!(scan.entries.is_empty(), "{what}");
            assert!(
                scan.problems.is_empty(),
                "{what}: {:?}",
                scan.problems.iter().map(|p| &p.error).collect::<Vec<_>>()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_project_file_reached_by_several_links_is_read_once() {
        let d = TempDir::new().unwrap();
        std::fs::create_dir_all(d.path().join("notes")).unwrap();
        std::fs::write(d.path().join("notes/real.md"), "- one\n").unwrap();
        std::fs::write(
            d.path().join("notes/e.yaml"),
            "errors:\n  - round: 1\n    entries: []\n",
        )
        .unwrap();
        let link = |rel: &str, to: &str| {
            let p = d.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::os::unix::fs::symlink(d.path().join(to), p).unwrap();
        };
        link(".claude/MEMORY.md", "notes/real.md");
        link("docs/memory/PROJECT-MEM.md", "notes/real.md");
        for c in ["c1", "c2", "c3"] {
            link(&format!("openspec/changes/{c}/errors.yaml"), "notes/e.yaml");
        }
        let scan = scan_project(d.path(), "demo");
        let count = |k: Kind| scan.entries.iter().filter(|e| e.kind == k).count();
        assert_eq!((count(Kind::Memory), count(Kind::Error)), (1, 1));
        assert!(scan.problems.is_empty());
    }

    /// Prints the path of every errors.yaml entry found under env CM_LIVE_ROOT (checkpoint CP-3);
    /// without the env it prints nothing.
    #[test]
    #[ignore]
    fn live_memory_errors() {
        let Ok(root) = std::env::var("CM_LIVE_ROOT") else {
            return;
        };
        for e in scan_project(Path::new(&root), "live").entries {
            if let Source::File { path, .. } = &e.source {
                println!("{path}");
            }
        }
    }
}
