use crate::app::{Edit, Project};
use crate::db::Db;
use crate::store::BlobStore;
use chrono::Utc;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};
use uuid::Uuid;
use walkdir::WalkDir;

const IGNORE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
    ".turbo",
    ".nuxt",
    ".svelte-kit",
    ".parcel-cache",
    "vendor",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".idea",
    ".vscode",
    "DerivedData",
    "Pods",
];

const IGNORE_EXTS: &[&str] = &[
    "log", "lock", "tmp", "swp", "swo", "pyc", "pyo", "class", "o", "a", "so", "dylib", "dll",
    "exe", "DS_Store",
];

const IGNORE_FILES: &[&str] = &[".DS_Store", "Thumbs.db", ".gitignore", ".dockerignore"];

const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024; // 5MB

pub struct WatcherManager {
    handles: Mutex<HashMap<String, WatcherHandle>>,
}

struct WatcherHandle {
    _watcher: RecommendedWatcher,
    _thread: thread::JoinHandle<()>,
}

impl WatcherManager {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_all(
        self: &Arc<Self>,
        app: AppHandle,
        db: Arc<Db>,
        blobs: Arc<BlobStore>,
    ) -> anyhow::Result<()> {
        let projects = db.list_projects()?;
        for p in projects {
            self.start_one(app.clone(), db.clone(), blobs.clone(), p);
        }
        Ok(())
    }

    pub fn start_one(
        self: &Arc<Self>,
        app: AppHandle,
        db: Arc<Db>,
        blobs: Arc<BlobStore>,
        project: Project,
    ) {
        let project_id = project.id.clone();
        let mut handles = self.handles.lock();
        if handles.contains_key(&project_id) {
            return;
        }

        let path = PathBuf::from(&project.path);
        if !path.exists() || !path.is_dir() {
            warn!("project path missing: {}", project.path);
            return;
        }

        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher: RecommendedWatcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                warn!("watcher init failed: {}", e);
                return;
            }
        };
        if let Err(e) = watcher.watch(&path, RecursiveMode::Recursive) {
            warn!("watch start failed: {}", e);
            return;
        }
        info!("watching project {} at {}", project_id, project.path);

        // Initial baseline scan
        let baseline_db = db.clone();
        let baseline_blobs = blobs.clone();
        let baseline_pid = project_id.clone();
        let baseline_path = path.clone();
        thread::spawn(move || {
            baseline_scan(&baseline_db, &baseline_blobs, &baseline_pid, &baseline_path);
        });

        let thread_app = app;
        let thread_db = db;
        let thread_blobs = blobs;
        let thread_pid = project_id.clone();
        let root = path.canonicalize().unwrap_or_else(|_| path.clone());
        let recent_changes: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let handle = thread::spawn(move || {
            for evt in rx {
                let evt = match evt {
                    Ok(e) => e,
                    Err(e) => {
                        warn!("watch err: {}", e);
                        continue;
                    }
                };
                if !matches!(
                    evt.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                ) {
                    continue;
                }
                for p in evt.paths {
                    if !should_track(&p) {
                        continue;
                    }
                    // debounce: ignore events for same path within 300ms
                    {
                        let mut rc = recent_changes.lock();
                        let now = Instant::now();
                        if let Some(last) = rc.get(&p) {
                            if now.duration_since(*last) < Duration::from_millis(300) {
                                continue;
                            }
                        }
                        rc.insert(p.clone(), now);
                    }
                    if let Err(e) = handle_change(&thread_db, &thread_blobs, &thread_pid, &root, &p)
                    {
                        warn!("handle_change err {}: {}", p.display(), e);
                    }
                }
                let _ = thread_app.emit("edits-changed", ());
            }
        });

        handles.insert(
            project_id,
            WatcherHandle {
                _watcher: watcher,
                _thread: handle,
            },
        );
    }

    pub fn stop_one(&self, project_id: &str) {
        let mut handles = self.handles.lock();
        handles.remove(project_id);
    }
}

fn baseline_scan(db: &Db, blobs: &BlobStore, project_id: &str, root: &Path) {
    let walker = WalkDir::new(root)
        .max_depth(8)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !IGNORE_DIRS.contains(&name.as_ref())
        });
    let mut count = 0;
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if !should_track(p) {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }
        }
        if let Ok(sha) = blobs.store_file(p) {
            let _ = db.upsert_watched_file(project_id, &p.to_string_lossy(), &sha);
            count += 1;
        }
    }
    info!("baseline scan project {}: {} files", project_id, count);
}

/// `root` is the canonical project folder. Besides a link at the file itself, a file whose folder resolves
/// outside `root` is skipped: notify on Linux follows folder links, so it reports files under a folder that
/// links out of the project.
fn handle_change(
    db: &Db,
    blobs: &BlobStore,
    project_id: &str,
    root: &Path,
    path: &Path,
) -> anyhow::Result<()> {
    let path_str = path.to_string_lossy().to_string();
    // A link is skipped, as the baseline scan skips it (`follow_links(false)`): it would copy what it points at
    // into the blob store. A link replacing a tracked file leaves that file's baseline row as it was.
    let meta = std::fs::symlink_metadata(path);
    if meta.as_ref().is_ok_and(|m| m.file_type().is_symlink()) {
        return Ok(());
    }
    // A parent that no longer resolves falls through: the file cannot exist, only the delete branch runs.
    if let Some(real) = path.parent().and_then(|p| p.canonicalize().ok()) {
        if !real.starts_with(root) {
            return Ok(());
        }
    }
    let exists = meta.as_ref().is_ok_and(|m| m.is_file());
    // While paused the baseline still moves, so a change made during the
    // pause is not reported later as part of the next edit; only the edit row
    // is skipped.
    let paused = crate::settings::is_paused(db);

    let prev_sha = db.get_watched_file(project_id, &path_str)?;

    if !exists {
        // File deleted
        if let Some(before) = prev_sha {
            let edit = Edit {
                id: Uuid::new_v4().to_string(),
                session_id: None,
                tool: "FS::Delete".into(),
                path: path_str.clone(),
                before_blob_sha: Some(before),
                after_blob_sha: String::new(),
                status: "pending".into(),
                hook_phase: "post".into(),
                created_at: Utc::now().to_rfc3339(),
                decided_at: None,
                explanation_md: None,
                explanation_cached_at: None,
                rollback_of_edit_id: None,
            };
            if !paused {
                db.insert_edit(&edit)?;
            }
        }
        return Ok(());
    }

    if meta.is_ok_and(|m| m.len() > MAX_FILE_SIZE) {
        return Ok(());
    }

    let new_sha = blobs.store_file(path)?;

    match prev_sha {
        Some(prev) if prev == new_sha => {
            // No real change
            return Ok(());
        }
        Some(prev) => {
            let edit = Edit {
                id: Uuid::new_v4().to_string(),
                session_id: None,
                tool: "FS::Modify".into(),
                path: path_str.clone(),
                before_blob_sha: Some(prev),
                after_blob_sha: new_sha.clone(),
                status: "pending".into(),
                hook_phase: "post".into(),
                created_at: Utc::now().to_rfc3339(),
                decided_at: None,
                explanation_md: None,
                explanation_cached_at: None,
                rollback_of_edit_id: None,
            };
            if !paused {
                db.insert_edit(&edit)?;
            }
        }
        None => {
            // First time seeing this file post-baseline: treat as new file edit
            let edit = Edit {
                id: Uuid::new_v4().to_string(),
                session_id: None,
                tool: "FS::Create".into(),
                path: path_str.clone(),
                before_blob_sha: None,
                after_blob_sha: new_sha.clone(),
                status: "pending".into(),
                hook_phase: "post".into(),
                created_at: Utc::now().to_rfc3339(),
                decided_at: None,
                explanation_md: None,
                explanation_cached_at: None,
                rollback_of_edit_id: None,
            };
            if !paused {
                db.insert_edit(&edit)?;
            }
        }
    }
    db.upsert_watched_file(project_id, &path_str, &new_sha)?;
    Ok(())
}

fn should_track(path: &Path) -> bool {
    for ancestor in path.ancestors() {
        if let Some(name) = ancestor.file_name().and_then(|n| n.to_str()) {
            if IGNORE_DIRS.contains(&name) {
                return false;
            }
        }
    }
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if IGNORE_FILES.contains(&name) {
            return false;
        }
        if name.starts_with('.') && !matches!(name, ".env" | ".env.local") {
            return false;
        }
    }
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if IGNORE_EXTS.contains(&ext.to_lowercase().as_str()) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    //! Unit tests for the pure `should_track` path filter.
    //!
    //! The watcher itself is a long-lived background thread reading from an
    //! `mpsc::Receiver<notify::Event>`. Exercising the live IO path here would
    //! require driving a real `notify::RecommendedWatcher` and an FS fixture —
    //! that belongs in an integration test, not a unit test. We instead lock
    //! down the pure decision function that determines whether any event is
    //! relevant. Coverage of that function == coverage of the filter contract.
    //!
    //! NOTE: `should_track` is module-private; the `#[cfg(test)] mod tests`
    //! block lives inside the same module so private access is legitimate.

    use super::should_track;
    use std::path::PathBuf;

    #[test]
    fn should_track_accepts_normal_source_file() {
        // Baseline: a typical source file under a normal project path is tracked.
        // If this fails the filter is over-eager and the watcher misses edits.
        assert!(should_track(&PathBuf::from("/tmp/proj/src/main.rs")));
        assert!(should_track(&PathBuf::from("/tmp/proj/README.md")));
        assert!(should_track(&PathBuf::from("/tmp/proj/Cargo.toml")));
    }

    #[test]
    fn should_track_rejects_ignored_dirs() {
        // Any ancestor segment in `IGNORE_DIRS` (node_modules, .git, target,
        // dist, etc.) skips the path. Verifying with one entry from each band
        // exercises the ancestor-walk loop.
        assert!(!should_track(&PathBuf::from(
            "/tmp/proj/node_modules/foo/index.js"
        )));
        assert!(!should_track(&PathBuf::from("/tmp/proj/.git/HEAD")));
        assert!(!should_track(&PathBuf::from("/tmp/proj/target/debug/x")));
        assert!(!should_track(&PathBuf::from(
            "/tmp/proj/__pycache__/foo.cpython.pyc"
        )));
    }

    #[test]
    fn should_track_rejects_ignored_extensions() {
        // Filter is case-insensitive (lowercased before lookup). Verify both
        // cases plus a benign extension that must pass through.
        assert!(!should_track(&PathBuf::from("/tmp/proj/app.log")));
        assert!(!should_track(&PathBuf::from("/tmp/proj/build.LOCK")));
        assert!(!should_track(&PathBuf::from("/tmp/proj/lib.dylib")));
        // Sanity: not on the list → tracked.
        assert!(should_track(&PathBuf::from("/tmp/proj/app.rs")));
    }

    #[test]
    fn should_track_rejects_ignored_files_and_dotfiles() {
        // Two distinct rules collapse into the file-name check:
        //   1. Explicit names in `IGNORE_FILES` (`.gitignore`, `Thumbs.db`, ...).
        //   2. Any file beginning with `.` EXCEPT the `.env*` allow-list, since
        //      env files are the only dotfiles worth diffing.
        assert!(!should_track(&PathBuf::from("/tmp/proj/.gitignore")));
        assert!(!should_track(&PathBuf::from("/tmp/proj/Thumbs.db")));
        // Generic dotfile rejected.
        assert!(!should_track(&PathBuf::from("/tmp/proj/.eslintrc")));
        // `.env` allow-listed.
        assert!(should_track(&PathBuf::from("/tmp/proj/.env")));
        assert!(should_track(&PathBuf::from("/tmp/proj/.env.local")));
    }

    mod pause {
        use super::super::handle_change;
        use crate::app::EditFilter;
        use crate::test_support::{test_state, TestState};

        fn recorded(fx: &TestState) -> usize {
            fx.state.db.list_edits(EditFilter::default()).unwrap().len()
        }

        #[test]
        fn a_paused_watcher_records_no_change_row_but_keeps_the_baseline() {
            let fx = test_state();
            let dir = tempfile::TempDir::new().unwrap();
            let f = dir.path().join("a.rs");
            std::fs::write(&f, "one").unwrap();
            fx.state.db.set_setting("paused", "true").unwrap();
            handle_change(
                &fx.state.db,
                &fx.state.blobs,
                "p1",
                &dir.path().canonicalize().unwrap(),
                &f,
            )
            .unwrap();
            assert_eq!(recorded(&fx), 0);
            fx.state.db.set_setting("paused", "false").unwrap();
            std::fs::write(&f, "two").unwrap();
            handle_change(
                &fx.state.db,
                &fx.state.blobs,
                "p1",
                &dir.path().canonicalize().unwrap(),
                &f,
            )
            .unwrap();
            assert_eq!(recorded(&fx), 1);
        }

        #[test]
        fn pausing_between_two_events_records_the_first_only() {
            let fx = test_state();
            let dir = tempfile::TempDir::new().unwrap();
            let f = dir.path().join("b.rs");
            std::fs::write(&f, "one").unwrap();
            handle_change(
                &fx.state.db,
                &fx.state.blobs,
                "p1",
                &dir.path().canonicalize().unwrap(),
                &f,
            )
            .unwrap();
            assert_eq!(recorded(&fx), 1);
            fx.state.db.set_setting("paused", "true").unwrap();
            std::fs::write(&f, "two").unwrap();
            handle_change(
                &fx.state.db,
                &fx.state.blobs,
                "p1",
                &dir.path().canonicalize().unwrap(),
                &f,
            )
            .unwrap();
            assert_eq!(recorded(&fx), 1);
        }
    }
    #[cfg(unix)]
    mod links {
        use super::super::handle_change;
        use crate::app::EditFilter;
        use crate::test_support::test_state;

        #[test]
        fn a_change_event_on_a_link_records_nothing_and_stores_no_blob() {
            let fx = test_state();
            let dir = tempfile::TempDir::new().unwrap();
            let outside = tempfile::TempDir::new().unwrap();
            std::fs::write(outside.path().join("creds"), "SECRET").unwrap();
            let link = dir.path().join("notes.md");
            std::os::unix::fs::symlink(outside.path().join("creds"), &link).unwrap();
            handle_change(
                &fx.state.db,
                &fx.state.blobs,
                "p1",
                &dir.path().canonicalize().unwrap(),
                &link,
            )
            .unwrap();
            assert_eq!(
                fx.state.db.list_edits(EditFilter::default()).unwrap().len(),
                0
            );
            assert_eq!(
                fx.state
                    .db
                    .get_watched_file("p1", &link.to_string_lossy())
                    .unwrap(),
                None
            );
            assert!(fx
                .state
                .blobs
                .read_bytes(&crate::store::sha256_hex(b"SECRET"))
                .is_err());
        }

        #[test]
        fn a_file_under_a_folder_linked_out_of_the_project_is_not_recorded() {
            let fx = test_state();
            let dir = tempfile::TempDir::new().unwrap();
            let root = dir.path().canonicalize().unwrap();
            let outside = tempfile::TempDir::new().unwrap();
            std::fs::write(outside.path().join("a.md"), "SECRET").unwrap();
            std::os::unix::fs::symlink(outside.path(), root.join("linked")).unwrap();
            let seen = root.join("linked/a.md");
            handle_change(&fx.state.db, &fx.state.blobs, "p1", &root, &seen).unwrap();
            assert_eq!(
                fx.state.db.list_edits(EditFilter::default()).unwrap().len(),
                0
            );
            assert_eq!(
                fx.state
                    .db
                    .get_watched_file("p1", &seen.to_string_lossy())
                    .unwrap(),
                None
            );
            assert!(fx
                .state
                .blobs
                .read_bytes(&crate::store::sha256_hex(b"SECRET"))
                .is_err());
        }

        #[test]
        fn a_tracked_file_replaced_by_a_link_records_nothing() {
            let fx = test_state();
            let dir = tempfile::TempDir::new().unwrap();
            let outside = tempfile::TempDir::new().unwrap();
            std::fs::write(outside.path().join("creds"), "SECRET").unwrap();
            let f = dir.path().join("a.md");
            std::fs::write(&f, "one").unwrap();
            handle_change(
                &fx.state.db,
                &fx.state.blobs,
                "p1",
                &dir.path().canonicalize().unwrap(),
                &f,
            )
            .unwrap();
            let before = fx.state.db.list_edits(EditFilter::default()).unwrap().len();
            std::fs::remove_file(&f).unwrap();
            std::os::unix::fs::symlink(outside.path().join("creds"), &f).unwrap();
            handle_change(
                &fx.state.db,
                &fx.state.blobs,
                "p1",
                &dir.path().canonicalize().unwrap(),
                &f,
            )
            .unwrap();
            assert_eq!(
                fx.state.db.list_edits(EditFilter::default()).unwrap().len(),
                before
            );
            assert!(fx
                .state
                .blobs
                .read_bytes(&crate::store::sha256_hex(b"SECRET"))
                .is_err());
        }
    }
}
