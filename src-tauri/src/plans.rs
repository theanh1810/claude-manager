//! The plan folders of registered projects, read only (UC-003): the tree of changes, live specs and runs
//! without a plan, one change in detail, and one plan file. Everything is read from disk when asked, so a
//! change written after the app was built shows on the next call. Nothing here writes.

use crate::app::AppState;
use crate::db::Db;
use crate::specs::errors::{errors_section, ErrorsOk, Verdict};
use crate::specs::plan_files::{
    approval_state, read_opened, review_section, section_from, tasks_section, Approval, ReviewOk,
    Section, TasksOk,
};
use crate::specs::{reader, registered_project_root};
use crate::store::mask_err;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::State;
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Presence {
    Present,
    Missing,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PlanChangeRow {
    /// The folder name; for a closed change without its `YYYY-MM-DD-` prefix.
    pub id: String,
    /// Relative to the project; what `plans_change` takes.
    pub dir: String,
    pub closed: bool,
    pub archived_date: Option<String>,
    /// None when the change has no `tasks.md`, or one that cannot be read or summarised.
    pub tasks_done: Option<u32>,
    pub tasks_total: Option<u32>,
    /// True when `tasks.md` exists but could not be read or has no task line.
    pub tasks_unreadable: bool,
    pub approval: Approval,
    /// Verdict of the newest round of `errors.yaml`.
    pub latest_verdict: Option<Verdict>,
    /// Milliseconds since the epoch of the newest file in the folder (depth 4 at most).
    pub modified_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PlanSpecRow {
    pub capability: String,
    /// Relative to the project.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AdhocRow {
    pub slug: String,
    pub date: Option<String>,
    pub dir: String,
    pub has_record: bool,
    pub has_independent: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PlansTree {
    pub openspec: Presence,
    pub changes: Vec<PlanChangeRow>,
    pub specs: Vec<PlanSpecRow>,
    pub debt: Option<String>,
    pub glossary: Option<String>,
    pub adhoc: Vec<AdhocRow>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DocRef {
    /// Relative to the change.
    pub label: String,
    /// Relative to the project; what `plans_read` takes.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PlanChangeDetail {
    pub id: String,
    pub dir: String,
    pub closed: bool,
    pub archived_date: Option<String>,
    pub approval: Approval,
    pub tasks: Section<TasksOk>,
    pub review: Section<ReviewOk>,
    pub errors: Section<ErrorsOk>,
    pub docs: Vec<DocRef>,
}

const OUTSIDE: &str = "path outside the plan folders";
const UNKNOWN_CHANGE: &str = "unknown change";
/// The folders `plans_read` may serve, each with the trailing slash a path must start with.
const READ_ROOTS: [&str; 2] = ["openspec/", "docs/changes/adhoc/"];
const ADHOC_DIR: &str = "docs/changes/adhoc";

/// Names of the subfolders of `dir`, in byte order; a missing folder gives none.
fn subfolders(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// `subfolders(dir)` kept to those whose real path, links followed, lies inside `base`: a folder that is a link
/// leaving `base` (or lying in a folder that is) is not listed.
fn inside_subfolders(dir: &Path, base: &Path) -> Vec<String> {
    let mut names = subfolders(dir);
    names.retain(|name| {
        dir.join(name)
            .canonicalize()
            .is_ok_and(|real| real.starts_with(base))
    });
    names
}

/// `YYYY-MM-DD-<rest>` split into the date and the rest; any other name has no date and stays whole.
fn split_date(name: &str) -> (Option<&str>, &str) {
    let b = name.as_bytes();
    let dated = b.len() > 11
        && b[..11].iter().enumerate().all(|(i, c)| {
            if matches!(i, 4 | 7 | 10) {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        });
    if dated {
        (Some(&name[..10]), &name[11..])
    } else {
        (None, name)
    }
}

/// `path` is a file whose real path, links followed, lies inside `base`.
fn inside_file(path: &Path, base: &Path) -> bool {
    path.canonicalize()
        .is_ok_and(|real| real.starts_with(base) && real.is_file())
}

fn file_ref(root: &Path, base: &Path, rel: &str) -> Option<String> {
    inside_file(&root.join(rel), base).then(|| rel.to_string())
}

/// `<project>/<sub>` with every link followed, when it is a folder lying inside the project (itself seen with
/// every link followed): a plan folder that is a link out of the project has no base, so nothing under it is read.
fn plan_base(root: &Path, sub: &str) -> Option<PathBuf> {
    let project = root.canonicalize().ok()?;
    let base = root.join(sub).canonicalize().ok()?;
    (base.is_dir() && base.starts_with(&project)).then_some(base)
}

/// `path` summarised by `parse`, unless it is a link that leads out of `base`: then its text is never read.
fn confined_section<T>(base: &Path, path: &Path, parse: fn(&str) -> Section<T>) -> Section<T> {
    match reader::open_inside(path, base) {
        Ok(Some(f)) => section_from(read_opened(&f), parse),
        Ok(None) => Section::Error {
            message: OUTSIDE.to_string(),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Section::Missing,
        Err(e) => Section::Error {
            message: mask_err(e),
        },
    }
}

/// Milliseconds since the epoch of the newest file under `dir`, four levels deep at most; `dir` is read through
/// its real path and only when that lies inside `base`, and links below it are not followed.
fn modified_at(dir: &Path, base: &Path) -> Option<u64> {
    let real = dir
        .canonicalize()
        .ok()
        .filter(|real| real.starts_with(base))?;
    let newest = WalkDir::new(real)
        .follow_root_links(false)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok()?.modified().ok())
        .max()?;
    Some(newest.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn change_row(root: &Path, base: &Path, name: &str, closed: bool) -> PlanChangeRow {
    let dir = if closed {
        format!("openspec/changes/archive/{name}")
    } else {
        format!("openspec/changes/{name}")
    };
    let folder = root.join(&dir);
    let (archived_date, id) = if closed {
        split_date(name)
    } else {
        (None, name)
    };
    let (tasks_done, tasks_total, tasks_unreadable) =
        match confined_section(base, &folder.join("tasks.md"), tasks_section) {
            Section::Ok(t) => (Some(t.done), Some(t.total), false),
            Section::Unreadable { .. } | Section::Error { .. } => (None, None, true),
            Section::Missing => (None, None, false),
        };
    let latest_verdict = match confined_section(base, &folder.join("errors.yaml"), errors_section) {
        Section::Ok(e) => e.rounds.first().map(|r| r.verdict),
        _ => None,
    };
    PlanChangeRow {
        id: id.to_string(),
        closed,
        archived_date: archived_date.map(String::from),
        tasks_done,
        tasks_total,
        tasks_unreadable,
        approval: approval_state(&folder, base),
        latest_verdict,
        modified_at: modified_at(&folder, base),
        dir,
    }
}

/// Open changes by latest write, then closed changes by archive date; both newest first, ties by name.
fn change_rows(root: &Path, base: &Path) -> Vec<PlanChangeRow> {
    let mut open: Vec<PlanChangeRow> = inside_subfolders(&root.join("openspec/changes"), base)
        .iter()
        .filter(|n| *n != "archive")
        .map(|n| change_row(root, base, n, false))
        .collect();
    let mut closed: Vec<PlanChangeRow> =
        inside_subfolders(&root.join("openspec/changes/archive"), base)
            .iter()
            .map(|n| change_row(root, base, n, true))
            .collect();
    open.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    closed.sort_by(|a, b| {
        b.archived_date
            .cmp(&a.archived_date)
            .then_with(|| a.id.cmp(&b.id))
    });
    open.extend(closed);
    open
}

fn spec_rows(root: &Path, base: &Path) -> Vec<PlanSpecRow> {
    inside_subfolders(&root.join("openspec/specs"), base)
        .into_iter()
        .filter_map(|capability| {
            let path = format!("openspec/specs/{capability}/spec.md");
            inside_file(&root.join(&path), base).then_some(PlanSpecRow { capability, path })
        })
        .collect()
}

/// Runs without a plan, newest date first then slug A to Z, undated runs last.
fn adhoc_rows(root: &Path) -> Vec<AdhocRow> {
    let Some(base) = plan_base(root, ADHOC_DIR) else {
        return Vec::new();
    };
    let mut rows: Vec<AdhocRow> = inside_subfolders(&root.join(ADHOC_DIR), &base)
        .into_iter()
        .map(|name| {
            let (date, slug) = split_date(&name);
            let dir = format!("{ADHOC_DIR}/{name}");
            AdhocRow {
                slug: slug.to_string(),
                date: date.map(String::from),
                has_record: inside_file(&root.join(&dir).join("record.md"), &base),
                has_independent: inside_file(&root.join(&dir).join("independent.md"), &base),
                dir,
            }
        })
        .collect();
    rows.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| a.slug.cmp(&b.slug)));
    rows
}

/// What the Plans tree shows for the project at `root`. Without an `openspec/` folder inside the project (a
/// link out of it counts as none) only the adhoc runs are listed; the older `docs/plan`, `docs/specs` and
/// `docs/changes/<id>` layouts are never read.
pub fn tree(root: &Path) -> PlansTree {
    let Some(base) = plan_base(root, "openspec") else {
        return PlansTree {
            openspec: Presence::Missing,
            changes: Vec::new(),
            specs: Vec::new(),
            debt: None,
            glossary: None,
            adhoc: adhoc_rows(root),
        };
    };
    PlansTree {
        openspec: Presence::Present,
        changes: change_rows(root, &base),
        specs: spec_rows(root, &base),
        debt: file_ref(root, &base, "openspec/_debt.md"),
        glossary: file_ref(root, &base, "openspec/glossary.md"),
        adhoc: adhoc_rows(root),
    }
}

/// The folder of a change named by `dir`: `openspec/changes/<name>` or `openspec/changes/archive/<name>`,
/// one plain segment that is a folder inside `openspec/` once links are followed. Returns it, whether it is
/// closed, and the base of `openspec/`.
fn change_folder(root: &Path, dir: &str) -> Result<(PathBuf, bool, PathBuf), String> {
    let unknown = || UNKNOWN_CHANGE.to_string();
    let (closed, name) = match dir.split('/').collect::<Vec<_>>()[..] {
        ["openspec", "changes", "archive", name] => (true, name),
        ["openspec", "changes", name] if name != "archive" => (false, name),
        _ => return Err(unknown()),
    };
    if matches!(name, "" | "." | "..") {
        return Err(unknown());
    }
    let base = plan_base(root, "openspec").ok_or_else(unknown)?;
    let folder = root.join(dir);
    let real = folder.canonicalize().map_err(|_| unknown())?;
    if real.starts_with(&base) && real.is_dir() {
        Ok((folder, closed, base))
    } else {
        Err(unknown())
    }
}

/// The documents of a change that exist: `plan.vi.md`, `proposal.md`, `design.md`, then each spec delta A to Z.
fn doc_refs(folder: &Path, base: &Path, dir: &str) -> Vec<DocRef> {
    let mut labels: Vec<String> = ["plan.vi.md", "proposal.md", "design.md"]
        .iter()
        .map(|l| l.to_string())
        .collect();
    labels.extend(
        inside_subfolders(&folder.join("specs"), base)
            .into_iter()
            .map(|c| format!("specs/{c}/spec.md")),
    );
    labels
        .into_iter()
        .filter(|label| inside_file(&folder.join(label), base))
        .map(|label| DocRef {
            path: format!("{dir}/{label}"),
            label,
        })
        .collect()
}

/// One change in detail. `dir` is the `dir` of a tree row; anything else is refused with "unknown change".
pub fn change_detail(root: &Path, dir: &str) -> Result<PlanChangeDetail, String> {
    let (folder, closed, base) = change_folder(root, dir)?;
    let name = dir.rsplit('/').next().unwrap_or(dir);
    let (archived_date, id) = if closed {
        split_date(name)
    } else {
        (None, name)
    };
    Ok(PlanChangeDetail {
        id: id.to_string(),
        dir: dir.to_string(),
        closed,
        archived_date: archived_date.map(String::from),
        approval: approval_state(&folder, &base),
        tasks: confined_section(&base, &folder.join("tasks.md"), tasks_section),
        review: confined_section(&base, &folder.join("review.md"), review_section),
        errors: confined_section(&base, &folder.join("errors.yaml"), errors_section),
        docs: doc_refs(&folder, &base, dir),
    })
}

/// The text of one plan file: `rel_path`, relative to the project, must lie under `openspec/` or
/// `docs/changes/adhoc/` once links are followed and each of those folders lies inside the project, with no
/// `..` segment and not absolute.
pub fn read(root: &Path, rel_path: &str) -> Result<String, String> {
    let Some(prefix) = READ_ROOTS.iter().find(|p| rel_path.starts_with(**p)) else {
        return Err(OUTSIDE.to_string());
    };
    let base = plan_base(root, prefix.trim_end_matches('/')).ok_or_else(|| OUTSIDE.to_string())?;
    reader::read_file_in(&base, &rel_path[prefix.len()..], "the plan folders")
}

fn tree_for(db: &Db, project: &str) -> Result<PlansTree, String> {
    registered_project_root(db, project).map(|root| tree(&root))
}

fn change_for(db: &Db, project: &str, dir: &str) -> Result<PlanChangeDetail, String> {
    change_detail(&registered_project_root(db, project)?, dir)
}

fn read_for(db: &Db, project: &str, rel_path: &str) -> Result<String, String> {
    read(&registered_project_root(db, project)?, rel_path)
}

// The three commands read the disk (every plan file of every change), so they run off the IPC thread.
#[tauri::command]
pub async fn plans_tree(project: String, state: State<'_, AppState>) -> Result<PlansTree, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || tree_for(&db, &project))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plans_change(
    project: String,
    dir: String,
    state: State<'_, AppState>,
) -> Result<PlanChangeDetail, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || change_for(&db, &project, &dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plans_read(
    project: String,
    rel_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || read_for(&db, &project, &rel_path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::Project;
    use crate::test_support::test_state;
    use std::time::{Duration, SystemTime};
    use tempfile::TempDir;

    fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    /// Sets the modified time of the file `rel` to `secs` after the epoch.
    fn stamp_time(root: &Path, rel: &str, secs: u64) {
        let f = std::fs::File::options()
            .write(true)
            .open(root.join(rel))
            .unwrap();
        f.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(secs))
            .unwrap();
    }

    fn register(db: &Db, id: &str, dir: &Path) {
        db.insert_project(&Project {
            id: id.into(),
            name: id.into(),
            path: dir.to_string_lossy().to_string(),
            color: None,
            added_at: "2026-10-01T00:00:00Z".into(),
            last_opened_at: None,
        })
        .unwrap();
    }

    fn task_md(ticks: &[bool]) -> String {
        let lines: String = ticks
            .iter()
            .enumerate()
            .map(|(i, t)| {
                format!(
                    "- [{}] 1.{} Task {}\n  Files: src/{i}.rs\n",
                    if *t { 'x' } else { ' ' },
                    i + 1,
                    i + 1
                )
            })
            .collect();
        format!("# Tasks\n\n## Wave 1\n\n{lines}")
    }

    fn ids(rows: &[PlanChangeRow]) -> Vec<&str> {
        rows.iter().map(|r| r.id.as_str()).collect()
    }

    fn keys(v: &impl Serialize) -> Vec<String> {
        let json = serde_json::to_value(v).unwrap();
        let mut k: Vec<String> = json.as_object().unwrap().keys().cloned().collect();
        k.sort();
        k
    }

    #[test]
    fn two_registered_projects_each_show_their_own_changes_and_specs() {
        let fx = test_state();
        let (a, b) = (TempDir::new().unwrap(), TempDir::new().unwrap());
        for (dir, name) in [(&a, "alpha"), (&b, "beta")] {
            put(
                dir.path(),
                &format!("openspec/changes/{name}-open/tasks.md"),
                &task_md(&[true]),
            );
            put(
                dir.path(),
                &format!("openspec/changes/archive/2026-01-02-{name}-done/proposal.md"),
                "# P\n",
            );
            put(
                dir.path(),
                &format!("openspec/specs/{name}-cap/spec.md"),
                "## Purpose\n",
            );
        }
        register(&fx.state.db, "a", a.path());
        register(&fx.state.db, "b", b.path());
        for (dir, name) in [(&a, "alpha"), (&b, "beta")] {
            let t = tree_for(&fx.state.db, dir.path().to_str().unwrap()).unwrap();
            assert_eq!(t.openspec, Presence::Present);
            assert_eq!(
                ids(&t.changes),
                vec![format!("{name}-open"), format!("{name}-done")]
            );
            assert_eq!(
                t.specs,
                vec![PlanSpecRow {
                    capability: format!("{name}-cap"),
                    path: format!("openspec/specs/{name}-cap/spec.md")
                }]
            );
        }
    }

    #[test]
    fn open_changes_come_first_by_latest_write_and_closed_ones_by_archive_date() {
        let d = TempDir::new().unwrap();
        for rel in [
            "openspec/changes/older/tasks.md",
            "openspec/changes/newer/tasks.md",
            "openspec/changes/archive/2026-01-01-first/proposal.md",
            "openspec/changes/archive/2026-02-01-second/proposal.md",
            "openspec/changes/archive/2026-02-01-also/proposal.md",
            "openspec/changes/archive/undated/proposal.md",
        ] {
            put(d.path(), rel, "x\n");
        }
        stamp_time(d.path(), "openspec/changes/older/tasks.md", 1_000);
        stamp_time(d.path(), "openspec/changes/newer/tasks.md", 2_000);
        let t = tree(d.path());
        assert_eq!(
            ids(&t.changes),
            vec!["newer", "older", "also", "second", "first", "undated"]
        );
        let closed: Vec<(bool, Option<&str>)> = t
            .changes
            .iter()
            .map(|c| (c.closed, c.archived_date.as_deref()))
            .collect();
        assert_eq!(
            closed,
            vec![
                (false, None),
                (false, None),
                (true, Some("2026-02-01")),
                (true, Some("2026-02-01")),
                (true, Some("2026-01-01")),
                (true, None)
            ]
        );
        assert_eq!(t.changes[0].modified_at, Some(2_000_000));
    }

    #[test]
    fn modified_at_is_the_newest_file_within_four_levels_and_none_for_an_empty_folder() {
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/c/tasks.md", "x\n");
        put(d.path(), "openspec/changes/c/specs/a/spec.md", "x\n");
        put(
            d.path(),
            "openspec/changes/c/specs/a/deep/deeper/too-deep.md",
            "x\n",
        );
        std::fs::create_dir_all(d.path().join("openspec/changes/empty")).unwrap();
        stamp_time(d.path(), "openspec/changes/c/tasks.md", 1_000);
        stamp_time(d.path(), "openspec/changes/c/specs/a/spec.md", 3_000);
        stamp_time(
            d.path(),
            "openspec/changes/c/specs/a/deep/deeper/too-deep.md",
            9_000,
        );
        let t = tree(d.path());
        let by_id = |id: &str| t.changes.iter().find(|c| c.id == id).unwrap().modified_at;
        assert_eq!(
            by_id("c"),
            Some(3_000_000),
            "a file at depth 5 is not looked at"
        );
        assert_eq!(by_id("empty"), None);
    }

    #[test]
    fn modified_at_does_not_walk_a_change_folder_that_links_out_of_the_base() {
        let d = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        put(outside.path(), "tasks.md", "x\n");
        std::os::unix::fs::symlink(outside.path(), d.path().join("linked")).unwrap();
        let (project, elsewhere) = (
            d.path().canonicalize().unwrap(),
            outside.path().canonicalize().unwrap(),
        );
        assert_eq!(modified_at(&d.path().join("linked"), &project), None);
        assert!(
            modified_at(outside.path(), &elsewhere).is_some(),
            "the same folder read inside its own base has a file"
        );
    }

    /// The files of a one-task change whose approval.md stamp is current (`0179b621f341`, plan-check's own).
    fn approved_change(dir: &Path) {
        put(dir, "tasks.md", "## Wave 1\n- [ ] 1.1 A\n  Files: src/a.rs\n  Covers: none\n  Done when: ok\n  Test: unit\n");
        put(dir, "approval.md", "stamp: 0179b621f341\n");
    }

    fn link(from: &Path, to: &Path) {
        std::fs::create_dir_all(from.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(to, from).unwrap();
    }

    #[test]
    fn a_changes_folder_linked_out_of_openspec_lists_no_row() {
        let outside = TempDir::new().unwrap();
        approved_change(&outside.path().join("foo"));
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/_debt.md", "x\n");
        link(&d.path().join("openspec/changes"), outside.path());
        let t = tree(d.path());
        assert_eq!(t.openspec, Presence::Present);
        assert!(
            t.changes.is_empty(),
            "no row for a change read through a link that leaves openspec/"
        );
    }

    #[test]
    fn an_archive_or_a_change_folder_linked_out_lists_no_row() {
        let outside = TempDir::new().unwrap();
        approved_change(&outside.path().join("foo"));
        approved_change(&outside.path().join("2026-01-01-old"));
        let d = TempDir::new().unwrap();
        approved_change(&d.path().join("openspec/changes/mine"));
        link(&d.path().join("openspec/changes/archive"), outside.path());
        link(
            &d.path().join("openspec/changes/bar"),
            &outside.path().join("foo"),
        );
        let t = tree(d.path());
        assert_eq!(
            ids(&t.changes),
            ["mine"],
            "no closed row and no open row for the links"
        );
    }

    #[test]
    fn a_change_folder_linked_within_openspec_still_lists_and_approves() {
        let d = TempDir::new().unwrap();
        approved_change(&d.path().join("openspec/shared/foo"));
        link(
            &d.path().join("openspec/changes/alias"),
            &d.path().join("openspec/shared/foo"),
        );
        let t = tree(d.path());
        assert_eq!(ids(&t.changes), ["alias"]);
        assert_eq!(t.changes[0].approval, Approval::Approved);
        assert!(t.changes[0].modified_at.is_some());
    }

    #[test]
    fn spec_and_adhoc_folders_linked_out_list_no_row() {
        let outside = TempDir::new().unwrap();
        put(outside.path(), "cap/spec.md", "## Purpose\n");
        put(outside.path(), "run/record.md", "x\n");

        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/c/tasks.md", &task_md(&[false]));
        link(&d.path().join("openspec/specs"), outside.path());
        assert!(tree(d.path()).specs.is_empty(), "openspec/specs linked out");

        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/specs/real/spec.md", "## Purpose\n");
        link(
            &d.path().join("openspec/specs/cap"),
            &outside.path().join("cap"),
        );
        let t = tree(d.path());
        assert_eq!(
            t.specs
                .iter()
                .map(|s| s.capability.as_str())
                .collect::<Vec<_>>(),
            ["real"]
        );

        let d = TempDir::new().unwrap();
        put(d.path(), "docs/changes/adhoc/2026-01-02-y/record.md", "x\n");
        link(
            &d.path().join("docs/changes/adhoc/2026-01-01-x"),
            &outside.path().join("run"),
        );
        let t = tree(d.path());
        assert_eq!(
            t.adhoc.iter().map(|a| a.slug.as_str()).collect::<Vec<_>>(),
            ["y"]
        );
    }

    #[test]
    fn a_change_under_the_archive_is_closed_and_its_id_drops_the_date() {
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "openspec/changes/archive/2026-01-02-demo/tasks.md",
            &task_md(&[true]),
        );
        put(
            d.path(),
            "openspec/changes/archive/2026-01-02-demo/plan.vi.md",
            "# Plan\n",
        );
        put(
            d.path(),
            "openspec/changes/archive/old-style/tasks.md",
            &task_md(&[false]),
        );
        let t = tree(d.path());
        let demo = &t.changes[0];
        assert_eq!(
            (demo.id.as_str(), demo.closed, demo.archived_date.as_deref()),
            ("demo", true, Some("2026-01-02"))
        );
        assert_eq!(demo.dir, "openspec/changes/archive/2026-01-02-demo");
        let old = &t.changes[1];
        assert_eq!(
            (old.id.as_str(), old.closed, old.archived_date.as_deref()),
            ("old-style", true, None)
        );
        let detail = change_detail(d.path(), &demo.dir).unwrap();
        assert_eq!(
            (
                detail.id.as_str(),
                detail.closed,
                detail.archived_date.as_deref()
            ),
            ("demo", true, Some("2026-01-02"))
        );
        assert_eq!(detail.dir, demo.dir);
    }

    #[test]
    fn a_finished_change_outside_the_archive_stays_open() {
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "openspec/changes/demo/tasks.md",
            &task_md(&[true, true, true]),
        );
        let t = tree(d.path());
        let row = &t.changes[0];
        assert_eq!(
            (
                row.closed,
                row.archived_date.as_deref(),
                row.tasks_done,
                row.tasks_total
            ),
            (false, None, Some(3), Some(3))
        );
        assert!(
            !change_detail(d.path(), "openspec/changes/demo")
                .unwrap()
                .closed
        );
    }

    #[test]
    fn a_change_created_after_the_first_read_shows_on_the_next_one() {
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "openspec/changes/first/tasks.md",
            &task_md(&[false]),
        );
        assert_eq!(ids(&tree(d.path()).changes), vec!["first"]);
        put(
            d.path(),
            "openspec/changes/second/tasks.md",
            &task_md(&[false]),
        );
        assert_eq!(tree(d.path()).changes.len(), 2);
        put(
            d.path(),
            "openspec/changes/first/tasks.md",
            &task_md(&[true]),
        );
        assert_eq!(
            tree(d.path())
                .changes
                .iter()
                .find(|c| c.id == "first")
                .unwrap()
                .tasks_done,
            Some(1)
        );
    }

    #[test]
    fn a_change_without_errors_yaml_has_no_test_round() {
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "openspec/changes/demo/tasks.md",
            &task_md(&[false]),
        );
        assert_eq!(tree(d.path()).changes[0].latest_verdict, None);
        assert_eq!(
            change_detail(d.path(), "openspec/changes/demo")
                .unwrap()
                .errors,
            Section::Missing
        );
    }

    #[test]
    fn the_latest_test_round_marks_the_row() {
        let d = TempDir::new().unwrap();
        let rounds = "errors:\n  - round: 1\n    verdict: red\n    entries: []\n  - round: 2\n    verdict: green\n    entries: []\n";
        put(d.path(), "openspec/changes/demo/errors.yaml", rounds);
        put(
            d.path(),
            "openspec/changes/bad/errors.yaml",
            "errors:\n  - round: 1\n    verdict: blue\n",
        );
        let t = tree(d.path());
        let verdict = |id: &str| {
            t.changes
                .iter()
                .find(|c| c.id == id)
                .unwrap()
                .latest_verdict
        };
        assert_eq!(verdict("demo"), Some(Verdict::Green));
        assert_eq!(verdict("bad"), None);
    }

    #[test]
    fn a_change_without_tasks_md_shows_no_task_count() {
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/demo/plan.vi.md", "# Plan\n");
        put(d.path(), "openspec/changes/prose/tasks.md", "just prose\n");
        let t = tree(d.path());
        let counts = |id: &str| {
            let r = t.changes.iter().find(|c| c.id == id).unwrap();
            (r.tasks_done, r.tasks_total)
        };
        assert_eq!(counts("demo"), (None, None));
        assert_eq!(
            change_detail(d.path(), "openspec/changes/demo")
                .unwrap()
                .tasks,
            Section::Missing
        );
    }

    #[test]
    fn an_unreadable_tasks_md_is_flagged_and_shows_no_count() {
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/demo/plan.vi.md", "# Plan\n");
        put(d.path(), "openspec/changes/prose/tasks.md", "just prose\n");
        put(
            d.path(),
            "openspec/changes/big/tasks.md",
            &"x".repeat(2 * 1024 * 1024 + 1),
        );
        put(
            d.path(),
            "openspec/changes/fine/tasks.md",
            &task_md(&[true]),
        );
        let t = tree(d.path());
        let row = |id: &str| {
            let r = t.changes.iter().find(|c| c.id == id).unwrap();
            (r.tasks_done, r.tasks_total, r.tasks_unreadable)
        };
        assert_eq!(row("prose"), (None, None, true));
        assert_eq!(row("big"), (None, None, true));
        assert_eq!(
            row("demo"),
            (None, None, false),
            "no tasks.md is not an unreadable one"
        );
        assert_eq!(row("fine"), (Some(1), Some(1), false));
    }

    #[test]
    fn the_detail_summarises_every_plan_file_and_one_malformed_file_leaves_the_others() {
        let d = TempDir::new().unwrap();
        let base = "openspec/changes/demo";
        put(
            d.path(),
            &format!("{base}/tasks.md"),
            &task_md(&[true, false]),
        );
        put(
            d.path(),
            &format!("{base}/review.md"),
            "## Round 1 · independent\nok\n",
        );
        put(
            d.path(),
            &format!("{base}/errors.yaml"),
            "errors:\n  - round: 1\n    verdict: blue\n    entries: []\n",
        );
        let detail = change_detail(d.path(), base).unwrap();
        assert!(matches!(&detail.tasks, Section::Ok(t) if (t.done, t.total) == (1, 2)));
        assert!(matches!(&detail.review, Section::Ok(r) if r.rounds.len() == 1));
        assert!(matches!(&detail.errors, Section::Unreadable { raw } if raw.contains("blue")));
        assert_eq!(detail.approval, Approval::NotApproved);
        put(d.path(), &format!("{base}/tasks.md"), "only prose\n");
        put(d.path(), &format!("{base}/review.md"), "# Notes\n");
        let detail = change_detail(d.path(), base).unwrap();
        assert!(
            matches!(detail.tasks, Section::Unreadable { .. })
                && matches!(detail.review, Section::Unreadable { .. })
        );
    }

    #[test]
    fn the_approval_of_a_row_and_of_its_detail_come_from_the_stamp() {
        let d = TempDir::new().unwrap();
        let base = "openspec/changes/demo";
        put(d.path(), &format!("{base}/tasks.md"), &task_md(&[false]));
        put(
            d.path(),
            &format!("{base}/approval.md"),
            "stamp: 000000000000\n",
        );
        assert_eq!(tree(d.path()).changes[0].approval, Approval::Stale);
        assert_eq!(
            change_detail(d.path(), base).unwrap().approval,
            Approval::Stale
        );
        std::fs::remove_file(d.path().join(format!("{base}/approval.md"))).unwrap();
        assert_eq!(tree(d.path()).changes[0].approval, Approval::NotApproved);
    }

    #[test]
    fn the_detail_lists_the_documents_that_exist_with_plan_vi_first() {
        let d = TempDir::new().unwrap();
        let base = "openspec/changes/demo";
        for f in [
            "design.md",
            "specs/b/spec.md",
            "specs/a/spec.md",
            "proposal.md",
            "plan.vi.md",
            "notes.md",
            "specs/c/readme.md",
        ] {
            put(d.path(), &format!("{base}/{f}"), "x\n");
        }
        std::fs::remove_file(d.path().join(format!("{base}/proposal.md"))).unwrap();
        let docs = change_detail(d.path(), base).unwrap().docs;
        let shape: Vec<(&str, &str)> = docs
            .iter()
            .map(|r| (r.label.as_str(), r.path.as_str()))
            .collect();
        assert_eq!(
            shape,
            vec![
                ("plan.vi.md", "openspec/changes/demo/plan.vi.md"),
                ("design.md", "openspec/changes/demo/design.md"),
                ("specs/a/spec.md", "openspec/changes/demo/specs/a/spec.md"),
                ("specs/b/spec.md", "openspec/changes/demo/specs/b/spec.md"),
            ]
        );
        put(
            d.path(),
            "openspec/changes/bare/tasks.md",
            &task_md(&[false]),
        );
        assert!(change_detail(d.path(), "openspec/changes/bare")
            .unwrap()
            .docs
            .is_empty());
    }

    #[test]
    fn specs_come_a_to_z_with_the_debt_and_glossary_when_they_exist() {
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/specs/zeta/spec.md", "x\n");
        put(d.path(), "openspec/specs/alpha/spec.md", "x\n");
        put(d.path(), "openspec/specs/no-spec-file/notes.md", "x\n");
        let t = tree(d.path());
        let caps: Vec<&str> = t.specs.iter().map(|s| s.capability.as_str()).collect();
        assert_eq!(caps, vec!["alpha", "zeta"]);
        assert_eq!((t.debt, t.glossary), (None, None));
        put(d.path(), "openspec/_debt.md", "x\n");
        put(d.path(), "openspec/glossary.md", "x\n");
        let t = tree(d.path());
        assert_eq!(
            (t.debt.as_deref(), t.glossary.as_deref()),
            (Some("openspec/_debt.md"), Some("openspec/glossary.md"))
        );
    }

    #[test]
    fn adhoc_runs_come_newest_first_then_by_slug_and_undated_ones_last() {
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-01-fix-a/record.md",
            "x\n",
        );
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-05-fix-b/record.md",
            "x\n",
        );
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-05-fix-b/independent.md",
            "x\n",
        );
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-05-fix-a/notes.md",
            "x\n",
        );
        put(d.path(), "docs/changes/adhoc/loose/record.md", "x\n");
        put(d.path(), "docs/changes/adhoc/fix.change-map.json", "{}");
        let rows = tree(d.path()).adhoc;
        let shape: Vec<(&str, Option<&str>, bool, bool)> = rows
            .iter()
            .map(|r| {
                (
                    r.slug.as_str(),
                    r.date.as_deref(),
                    r.has_record,
                    r.has_independent,
                )
            })
            .collect();
        assert_eq!(
            shape,
            vec![
                ("fix-a", Some("2026-03-05"), false, false),
                ("fix-b", Some("2026-03-05"), true, true),
                ("fix-a", Some("2026-03-01"), true, false),
                ("loose", None, true, false),
            ]
        );
        assert_eq!(rows[1].dir, "docs/changes/adhoc/2026-03-05-fix-b");
    }

    #[test]
    fn a_project_without_openspec_lists_its_adhoc_runs_and_no_legacy_plan() {
        let d = TempDir::new().unwrap();
        put(d.path(), "docs/plan/old/plan.yaml", "plan_id: x\n");
        put(d.path(), "docs/specs/use-cases/UC-001-a.md", "# UC\n");
        put(d.path(), "docs/changes/older/plan.yaml", "plan_id: y\n");
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-05-fix/record.md",
            "x\n",
        );
        let t = tree(d.path());
        assert_eq!(t.openspec, Presence::Missing);
        assert!(
            t.changes.is_empty() && t.specs.is_empty() && t.debt.is_none() && t.glossary.is_none()
        );
        assert_eq!(t.adhoc.len(), 1);
    }

    #[test]
    fn an_empty_project_folder_has_an_empty_tree() {
        let d = TempDir::new().unwrap();
        let t = tree(d.path());
        assert_eq!(t.openspec, Presence::Missing);
        assert!(t.adhoc.is_empty());
        let d = TempDir::new().unwrap();
        std::fs::create_dir_all(d.path().join("openspec")).unwrap();
        let t = tree(d.path());
        assert_eq!(t.openspec, Presence::Present);
        assert!(t.changes.is_empty() && t.specs.is_empty());
    }

    #[test]
    fn a_file_inside_the_plan_folders_is_read() {
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/demo/plan.vi.md", "# Plan\n");
        put(d.path(), "openspec/specs/cap/spec.md", "## Purpose\n");
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-05-fix/record.md",
            "# Record\n",
        );
        assert_eq!(
            read(d.path(), "openspec/changes/demo/plan.vi.md").unwrap(),
            "# Plan\n"
        );
        assert_eq!(
            read(d.path(), "openspec/specs/cap/spec.md").unwrap(),
            "## Purpose\n"
        );
        assert_eq!(
            read(d.path(), "docs/changes/adhoc/2026-03-05-fix/record.md").unwrap(),
            "# Record\n"
        );
    }

    #[test]
    fn a_path_leaving_the_plan_folders_is_refused() {
        let d = TempDir::new().unwrap();
        put(d.path(), "secret.txt", "secret");
        put(d.path(), "openspec/changes/demo/plan.vi.md", "# Plan\n");
        put(d.path(), "docs/specs/README.md", "# Specs\n");
        put(d.path(), "docs/changes/older/plan.vi.md", "# Older\n");
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-05-fix/record.md",
            "x\n",
        );
        std::os::unix::fs::symlink(
            d.path().join("secret.txt"),
            d.path().join("openspec/changes/demo/link.md"),
        )
        .unwrap();
        let outside = TempDir::new().unwrap();
        put(outside.path(), "x.md", "outside");
        std::os::unix::fs::symlink(outside.path(), d.path().join("openspec/linked-folder"))
            .unwrap();
        let absolute = d.path().join("secret.txt").to_string_lossy().to_string();
        for bad in [
            "",
            "openspec",
            "openspec/",
            "openspec/../secret.txt",
            "openspec/changes/../../secret.txt",
            "docs/changes/adhoc/../../../secret.txt",
            "/etc/passwd",
            absolute.as_str(),
            "docs/specs/README.md",
            "docs/changes/older/plan.vi.md",
            "docs/changes/adhoc",
            "openspecx/changes/demo/plan.vi.md",
            "secret.txt",
            "openspec/changes/demo/link.md",
            "openspec/linked-folder/x.md",
        ] {
            assert_eq!(read(d.path(), bad).unwrap_err(), OUTSIDE, "{bad:?}");
        }
        assert!(read(d.path(), "openspec/changes/demo/missing.md").is_err());
    }

    /// A folder holding what a plan folder would: a secret, a change with tasks, a spec, the debt and the glossary.
    fn plan_like_folder_elsewhere() -> TempDir {
        let outside = TempDir::new().unwrap();
        put(outside.path(), ".ssh/id_ed25519", "PRIVATE KEY");
        put(outside.path(), "changes/demo/tasks.md", &task_md(&[false]));
        put(outside.path(), "specs/cap/spec.md", "## Purpose\n");
        put(outside.path(), "_debt.md", "x\n");
        put(outside.path(), "glossary.md", "x\n");
        put(outside.path(), "2026-03-05-fix/record.md", "x\n");
        outside
    }

    #[test]
    fn a_plan_folder_linked_out_of_the_project_is_refused() {
        let outside = plan_like_folder_elsewhere();
        let d = TempDir::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("openspec")).unwrap();
        assert_eq!(
            read(d.path(), "openspec/.ssh/id_ed25519").unwrap_err(),
            OUTSIDE
        );
        assert_eq!(
            read(d.path(), "openspec/changes/demo/tasks.md").unwrap_err(),
            OUTSIDE
        );
        let t = tree(d.path());
        assert_eq!(t.openspec, Presence::Missing);
        assert!(
            t.changes.is_empty() && t.specs.is_empty() && t.debt.is_none() && t.glossary.is_none()
        );
        assert_eq!(
            change_detail(d.path(), "openspec/changes/demo").unwrap_err(),
            "unknown change"
        );

        let adhoc_out = plan_like_folder_elsewhere();
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "openspec/changes/demo/tasks.md",
            &task_md(&[false]),
        );
        std::fs::create_dir_all(d.path().join("docs/changes")).unwrap();
        std::os::unix::fs::symlink(adhoc_out.path(), d.path().join("docs/changes/adhoc")).unwrap();
        assert!(tree(d.path()).adhoc.is_empty());
        assert_eq!(
            read(d.path(), "docs/changes/adhoc/2026-03-05-fix/record.md").unwrap_err(),
            OUTSIDE
        );
        assert_eq!(
            tree(d.path()).changes.len(),
            1,
            "the project's own openspec still lists"
        );

        let docs_out = TempDir::new().unwrap();
        put(
            docs_out.path(),
            "changes/adhoc/2026-03-05-fix/record.md",
            "x\n",
        );
        let d = TempDir::new().unwrap();
        std::os::unix::fs::symlink(docs_out.path(), d.path().join("docs")).unwrap();
        assert!(tree(d.path()).adhoc.is_empty());
        assert_eq!(
            read(d.path(), "docs/changes/adhoc/2026-03-05-fix/record.md").unwrap_err(),
            OUTSIDE
        );
    }

    #[test]
    fn a_project_reached_through_a_link_still_reads() {
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/demo/plan.vi.md", "# Plan\n");
        put(
            d.path(),
            "openspec/changes/demo/tasks.md",
            &task_md(&[true]),
        );
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-05-fix/record.md",
            "# Record\n",
        );
        let holder = TempDir::new().unwrap();
        let via_link = holder.path().join("project-link");
        std::os::unix::fs::symlink(d.path(), &via_link).unwrap();
        assert_eq!(
            read(&via_link, "openspec/changes/demo/plan.vi.md").unwrap(),
            "# Plan\n"
        );
        assert_eq!(
            read(&via_link, "docs/changes/adhoc/2026-03-05-fix/record.md").unwrap(),
            "# Record\n"
        );
        let t = tree(&via_link);
        assert_eq!(
            (t.openspec, t.changes.len(), t.adhoc.len()),
            (Presence::Present, 1, 1)
        );
        assert!(change_detail(&via_link, "openspec/changes/demo").is_ok());
    }

    #[test]
    fn a_file_over_2_mib_is_refused() {
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "openspec/big.md",
            &"x".repeat(2 * 1024 * 1024 + 1),
        );
        assert_eq!(
            read(d.path(), "openspec/big.md").unwrap_err(),
            "file larger than 2 MiB"
        );
    }

    #[test]
    fn an_unregistered_project_is_refused_by_every_command() {
        let fx = test_state();
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/demo/plan.vi.md", "# Plan\n");
        let path = d.path().to_str().unwrap();
        assert_eq!(tree_for(&fx.state.db, path).unwrap_err(), "unknown project");
        assert_eq!(
            change_for(&fx.state.db, path, "openspec/changes/demo").unwrap_err(),
            "unknown project"
        );
        assert_eq!(
            read_for(&fx.state.db, path, "openspec/changes/demo/plan.vi.md").unwrap_err(),
            "unknown project"
        );
        register(&fx.state.db, "p", d.path());
        assert!(tree_for(&fx.state.db, path).is_ok());
        assert!(change_for(&fx.state.db, path, "openspec/changes/demo").is_ok());
        assert_eq!(
            read_for(&fx.state.db, path, "openspec/changes/demo/plan.vi.md").unwrap(),
            "# Plan\n"
        );
        let sub = format!("{path}/openspec");
        assert_eq!(
            tree_for(&fx.state.db, &sub).unwrap_err(),
            "unknown project",
            "a folder inside a project is not a project"
        );
    }

    #[test]
    fn a_change_dir_that_is_not_one_plain_change_folder_is_refused() {
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "openspec/changes/demo/tasks.md",
            &task_md(&[false]),
        );
        put(
            d.path(),
            "openspec/changes/archive/2026-01-02-old/tasks.md",
            &task_md(&[false]),
        );
        put(d.path(), "openspec/specs/cap/spec.md", "x\n");
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-05-fix/record.md",
            "x\n",
        );
        let outside = TempDir::new().unwrap();
        put(
            outside.path(),
            "tasks.md",
            "- [ ] 1.1 Outside\n  Files: x\n",
        );
        std::os::unix::fs::symlink(outside.path(), d.path().join("openspec/changes/linked"))
            .unwrap();
        let absolute = d
            .path()
            .join("openspec/changes/demo")
            .to_string_lossy()
            .to_string();
        for bad in [
            "",
            "openspec",
            "openspec/changes",
            "openspec/changes/",
            "openspec/changes/archive",
            "openspec/changes/archive/",
            "openspec/changes/missing",
            "openspec/changes/demo/",
            "openspec/changes/demo/specs",
            "openspec/changes/archive/2026-01-02-old/specs",
            "openspec/changes/../specs/cap",
            "openspec/changes/..",
            "openspec/changes/archive/..",
            "openspec/specs/cap",
            "docs/changes/adhoc/2026-03-05-fix",
            "/openspec/changes/demo",
            absolute.as_str(),
            "openspec/changes/linked",
            "openspec/changes/demo/tasks.md",
        ] {
            assert_eq!(
                change_detail(d.path(), bad).unwrap_err(),
                "unknown change",
                "{bad:?}"
            );
        }
        assert!(change_detail(d.path(), "openspec/changes/demo").is_ok());
        assert!(change_detail(d.path(), "openspec/changes/archive/2026-01-02-old").is_ok());
    }

    #[test]
    fn a_plan_file_linked_to_a_file_outside_the_project_is_never_shown() {
        let d = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        put(
            outside.path(),
            "secret.txt",
            "TOP SECRET prose without task lines\n",
        );
        let base = "openspec/changes/demo";
        std::fs::create_dir_all(d.path().join(base)).unwrap();
        for name in ["tasks.md", "review.md", "errors.yaml"] {
            std::os::unix::fs::symlink(
                outside.path().join("secret.txt"),
                d.path().join(base).join(name),
            )
            .unwrap();
        }
        let detail = change_detail(d.path(), base).unwrap();
        for section in [
            format!("{:?}", detail.tasks),
            format!("{:?}", detail.review),
            format!("{:?}", detail.errors),
        ] {
            assert!(!section.contains("SECRET"), "{section}");
            assert!(section.contains(OUTSIDE), "{section}");
        }
        let row = &tree(d.path()).changes[0];
        assert_eq!(
            (row.tasks_done, row.tasks_total, row.tasks_unreadable),
            (None, None, true)
        );
        assert_eq!(row.latest_verdict, None);
    }

    #[test]
    fn a_link_inside_the_plan_folders_to_another_plan_file_is_followed() {
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "openspec/changes/shared/tasks.md",
            &task_md(&[true, false]),
        );
        let base = "openspec/changes/demo";
        std::fs::create_dir_all(d.path().join(base)).unwrap();
        std::os::unix::fs::symlink(
            d.path().join("openspec/changes/shared/tasks.md"),
            d.path().join(base).join("tasks.md"),
        )
        .unwrap();
        assert!(
            matches!(change_detail(d.path(), base).unwrap().tasks, Section::Ok(t) if t.total == 2)
        );
    }

    #[test]
    fn every_shape_serialises_with_exactly_the_keys_the_renderer_types_name() {
        let d = TempDir::new().unwrap();
        let base = "openspec/changes/demo";
        put(d.path(), &format!("{base}/tasks.md"), &task_md(&[true]));
        put(d.path(), &format!("{base}/plan.vi.md"), "# Plan\n");
        put(d.path(), "openspec/specs/cap/spec.md", "x\n");
        put(
            d.path(),
            "docs/changes/adhoc/2026-03-05-fix/record.md",
            "x\n",
        );
        let t = tree(d.path());
        assert_eq!(
            keys(&t),
            vec!["adhoc", "changes", "debt", "glossary", "openspec", "specs"]
        );
        assert_eq!(
            keys(&t.changes[0]),
            vec![
                "approval",
                "archived_date",
                "closed",
                "dir",
                "id",
                "latest_verdict",
                "modified_at",
                "tasks_done",
                "tasks_total",
                "tasks_unreadable"
            ]
        );
        assert_eq!(keys(&t.specs[0]), vec!["capability", "path"]);
        assert_eq!(
            keys(&t.adhoc[0]),
            vec!["date", "dir", "has_independent", "has_record", "slug"]
        );
        let detail = change_detail(d.path(), base).unwrap();
        assert_eq!(
            keys(&detail),
            vec![
                "approval",
                "archived_date",
                "closed",
                "dir",
                "docs",
                "errors",
                "id",
                "review",
                "tasks"
            ]
        );
        assert_eq!(keys(&detail.docs[0]), vec!["label", "path"]);
        let json = serde_json::to_value(&t).unwrap();
        assert_eq!(json["openspec"], "present");
        assert_eq!(json["changes"][0]["approval"], "not_approved");
        assert_eq!(
            serde_json::to_value(tree(TempDir::new().unwrap().path())).unwrap()["openspec"],
            "missing"
        );
        let detail_json = serde_json::to_value(&detail).unwrap();
        assert_eq!(detail_json["tasks"]["state"], "ok");
        assert_eq!(
            detail_json["review"],
            serde_json::json!({ "state": "missing" })
        );
        assert_eq!(
            detail_json["errors"],
            serde_json::json!({ "state": "missing" })
        );
    }

    #[test]
    fn the_verdict_of_a_row_serialises_as_a_lower_case_word() {
        let d = TempDir::new().unwrap();
        put(
            d.path(),
            "openspec/changes/demo/errors.yaml",
            "errors:\n  - round: 1\n    verdict: yellow\n    entries: []\n",
        );
        let json = serde_json::to_value(&tree(d.path()).changes[0]).unwrap();
        assert_eq!(json["latest_verdict"], "yellow");
    }

    #[test]
    fn the_module_has_no_write_call() {
        let src = include_str!("plans.rs");
        let body = &src[..src.find("#[cfg(test)]").unwrap()];
        for w in [
            "fs::write",
            "File::create",
            "create_dir",
            "remove_file",
            "OpenOptions",
            "rename(",
        ] {
            assert!(!body.contains(w), "{w}");
        }
    }

    #[test]
    fn a_linked_out_specs_folder_or_document_of_a_change_is_not_listed() {
        let outside = TempDir::new().unwrap();
        put(outside.path(), "note.md", "secret\n");
        put(outside.path(), "specs/cap/spec.md", "secret\n");
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/demo/plan.vi.md", "# Plan\n");
        link(
            &d.path().join("openspec/changes/demo/design.md"),
            &outside.path().join("note.md"),
        );
        link(
            &d.path().join("openspec/changes/demo/specs"),
            &outside.path().join("specs"),
        );
        let detail = change_detail(d.path(), "openspec/changes/demo").unwrap();
        let labels: Vec<&str> = detail.docs.iter().map(|r| r.label.as_str()).collect();
        assert_eq!(labels, ["plan.vi.md"]);
    }

    #[test]
    fn debt_glossary_spec_and_adhoc_files_linked_out_are_absent() {
        let outside = TempDir::new().unwrap();
        put(outside.path(), "x.md", "secret\n");
        let x = outside.path().join("x.md");
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/.keep", "");
        link(&d.path().join("openspec/_debt.md"), &x);
        link(&d.path().join("openspec/glossary.md"), &x);
        link(&d.path().join("openspec/specs/cap/spec.md"), &x);
        link(
            &d.path().join("docs/changes/adhoc/2026-01-01-run/record.md"),
            &x,
        );
        link(
            &d.path()
                .join("docs/changes/adhoc/2026-01-01-run/independent.md"),
            &x,
        );
        let t = tree(d.path());
        assert_eq!(t.debt, None);
        assert_eq!(t.glossary, None);
        assert!(t.specs.is_empty());
        assert_eq!(t.adhoc.len(), 1);
        assert!(!t.adhoc[0].has_record);
        assert!(!t.adhoc[0].has_independent);
    }

    #[test]
    fn a_document_linked_to_another_plan_file_inside_openspec_is_listed() {
        let d = TempDir::new().unwrap();
        put(d.path(), "openspec/changes/other/design.md", "# D\n");
        put(d.path(), "openspec/changes/demo/plan.vi.md", "# Plan\n");
        link(
            &d.path().join("openspec/changes/demo/design.md"),
            &d.path().join("openspec/changes/other/design.md"),
        );
        let detail = change_detail(d.path(), "openspec/changes/demo").unwrap();
        let labels: Vec<&str> = detail.docs.iter().map(|r| r.label.as_str()).collect();
        assert_eq!(labels, ["plan.vi.md", "design.md"]);
    }
}
