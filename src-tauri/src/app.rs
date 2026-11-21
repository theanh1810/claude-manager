use crate::db::Db;
use crate::explain;
use crate::maintenance;
use crate::rollback;
use crate::settings::{self, Settings};
use crate::store::BlobStore;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub db: Arc<Db>,
    pub blobs: Arc<BlobStore>,
    pub watcher: Arc<crate::watcher::WatcherManager>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Edit {
    pub id: String,
    pub session_id: Option<String>,
    pub tool: String,
    pub path: String,
    pub before_blob_sha: Option<String>,
    pub after_blob_sha: String,
    pub status: String,
    pub hook_phase: String,
    pub created_at: String,
    pub decided_at: Option<String>,
    pub explanation_md: Option<String>,
    pub explanation_cached_at: Option<String>,
    pub rollback_of_edit_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct EditFilter {
    pub status: Option<String>,
    pub project: Option<String>,
    pub limit: Option<i64>,
    /// RFC 3339; only edits created at or after it. Unparsable is an error.
    pub since: Option<String>,
    /// RFC 3339; only edits created at or before it. Unparsable is an error.
    pub until: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    pub added_at: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EditDiff {
    pub before: String,
    pub after: String,
    pub path: String,
}

#[tauri::command]
fn list_edits(
    filter: Option<EditFilter>,
    state: State<AppState>,
) -> Result<Vec<crate::db::LabeledEdit>, String> {
    state
        .db
        .list_edits_labeled(filter.unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_edit(id: String, state: State<AppState>) -> Result<Edit, String> {
    state.db.get_edit(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_edit_diff(id: String, state: State<AppState>) -> Result<EditDiff, String> {
    let edit = state.db.get_edit(&id).map_err(|e| e.to_string())?;
    let before = if let Some(sha) = &edit.before_blob_sha {
        state.blobs.read_string(sha).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let after = state
        .blobs
        .read_string(&edit.after_blob_sha)
        .map_err(|e| e.to_string())?;
    Ok(EditDiff {
        before,
        after,
        path: edit.path,
    })
}

#[tauri::command]
fn accept_edit(id: String, state: State<AppState>) -> Result<(), String> {
    state.db.accept_pending(&id).map_err(|e| e.to_string())
}

/// `confirm_legacy` is true only after the user agreed to restore a legacy row (rollback.rs).
#[tauri::command]
fn reject_edit(
    id: String,
    confirm_legacy: Option<bool>,
    state: State<AppState>,
) -> Result<(), String> {
    rollback::reject(&state, &id, confirm_legacy.unwrap_or(false)).map_err(|e| e.to_string())
}

#[tauri::command]
fn rollback_edit(
    id: String,
    confirm_legacy: Option<bool>,
    state: State<AppState>,
) -> Result<(), String> {
    rollback::undo_accepted(&state, &id, confirm_legacy.unwrap_or(false)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn explain_edit(id: String, state: State<'_, AppState>) -> Result<String, String> {
    explain::explain(&state, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    settings::get_all(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_settings(patch: serde_json::Value, state: State<AppState>) -> Result<Settings, String> {
    settings::update(&state.db, patch).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_pause(state: State<AppState>) -> Result<bool, String> {
    settings::toggle_pause(&state.db).map_err(|e| e.to_string())
}

/// Persist a learning-mode change and broadcast it (W6-T6a + follow-up).
///
/// Order matters: write first, emit second. A listener that reacts to the
/// event by reading settings must not be able to observe the old value.
/// The renderer keeps a Zustand/localStorage copy purely as a warm-start
/// cache and re-syncs from `get_settings` on load — the DB is the owner,
/// because `explain` and the CLI cannot read renderer storage.
#[tauri::command]
fn settings_learning_toggle(
    enabled: bool,
    app: AppHandle,
    state: State<AppState>,
) -> Result<bool, String> {
    let stored = settings::set_learning(&state.db, enabled).map_err(|e| e.to_string())?;
    app.emit(settings::LEARNING_EVENT, settings::learning_payload(stored))
        .map_err(|e| e.to_string())?;
    Ok(stored)
}

#[derive(Debug, Serialize)]
pub struct BulkResult {
    pub success: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
fn accept_all(project_path: Option<String>, state: State<AppState>) -> Result<BulkResult, String> {
    let ids = state
        .db
        .list_pending_ids(project_path.as_deref())
        .map_err(|e| e.to_string())?;
    let mut ok = 0;
    let mut fail = 0;
    let mut errs = Vec::new();
    for id in ids {
        match state.db.accept_pending(&id) {
            Ok(_) => ok += 1,
            Err(e) => {
                fail += 1;
                errs.push(format!("{}: {}", id, e));
            }
        }
    }
    Ok(BulkResult {
        success: ok,
        failed: fail,
        errors: errs,
    })
}

#[tauri::command]
fn reject_all(project_path: Option<String>, state: State<AppState>) -> Result<BulkResult, String> {
    let ids = state
        .db
        .list_pending_ids(project_path.as_deref())
        .map_err(|e| e.to_string())?;
    let mut ok = 0;
    let mut fail = 0;
    let mut errs = Vec::new();
    for id in ids {
        match rollback::reject(&state, &id, false) {
            Ok(_) => ok += 1,
            Err(e) => {
                fail += 1;
                errs.push(format!("{}: {}", id, e));
            }
        }
    }
    Ok(BulkResult {
        success: ok,
        failed: fail,
        errors: errs,
    })
}

#[tauri::command]
fn list_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    state.db.list_projects().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_project(
    app: tauri::AppHandle,
    path: String,
    name: Option<String>,
    color: Option<String>,
    state: State<AppState>,
) -> Result<Project, String> {
    let path_normalized = std::path::PathBuf::from(&path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(path.clone());
    let name = name.unwrap_or_else(|| {
        std::path::Path::new(&path_normalized)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_normalized.clone())
    });
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path: path_normalized,
        color,
        added_at: chrono::Utc::now().to_rfc3339(),
        last_opened_at: None,
    };
    state
        .db
        .insert_project(&project)
        .map_err(|e| e.to_string())?;
    state
        .watcher
        .start_one(app, state.db.clone(), state.blobs.clone(), project.clone());
    Ok(project)
}

#[tauri::command]
fn remove_project(id: String, state: State<AppState>) -> Result<(), String> {
    state.watcher.stop_one(&id);
    state
        .db
        .delete_watched_files(&id)
        .map_err(|e| e.to_string())?;
    state.db.delete_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn touch_project(id: String, state: State<AppState>) -> Result<(), String> {
    state.db.touch_project(&id).map_err(|e| e.to_string())
}

/// The mem0 key lives in Settings; the memory module never reads Settings.
#[tauri::command]
async fn memory_list(
    project: Option<String>,
    state: State<'_, AppState>,
    allow: State<'_, crate::memory::OpenAllow>,
) -> Result<crate::memory::MemoryList, String> {
    let key = settings::get_all(&state.db)
        .map_err(|e| e.to_string())?
        .mem0_api_key;
    let home = directories::UserDirs::new()
        .map(|d| d.home_dir().to_path_buf())
        .ok_or_else(|| "cannot locate the home folder".to_string())?;
    Ok(crate::memory::list(
        &state.db,
        project.as_deref(),
        key.as_deref(),
        &home,
        &crate::memory::Mem0Config::default(),
        &allow,
    )
    .await)
}

/// Open a source file the last `memory_list` returned, by its real path: in the default text editor on macOS,
/// in the default app elsewhere.
#[allow(deprecated)] // tauri-plugin-opener would be a new dependency; the shell plugin is already in use
#[tauri::command]
fn memory_open_file(
    path: String,
    app: AppHandle,
    allow: State<crate::memory::OpenAllow>,
) -> Result<(), String> {
    crate::memory::open_file(&allow, &path, |p| {
        #[cfg(target_os = "macos")]
        {
            let _ = &app;
            let status = std::process::Command::new("/usr/bin/open")
                .arg("-t")
                .arg(p)
                .status()
                .map_err(|e| e.to_string())?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("open: {status}"))
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            use tauri_plugin_shell::ShellExt;
            app.shell().open(p, None).map_err(|e| e.to_string())
        }
    })
}

/// Move one session (its transcript and same-stem folder) to the Trash. It
/// checks only the never-touch rule, not the latest scan or the age cut-off.
#[tauri::command]
fn session_trash(
    id: String,
    state: State<AppState>,
) -> Result<Vec<crate::cleanup::trash::TrashResult>, String> {
    let root =
        crate::cleanup::claude_root().ok_or_else(|| "cannot locate ~/.claude".to_string())?;
    let projects = root.join("projects");
    let paths = crate::sessions::session_path(&state.db, &id)?;
    Ok(paths
        .into_iter()
        .map(|p| {
            if !p.starts_with(&projects)
                || crate::cleanup::scan::never_touch_reason(&root, &p).is_some()
            {
                crate::cleanup::trash::TrashResult::rejected(
                    &p.to_string_lossy(),
                    "not a session path",
                )
            } else {
                crate::cleanup::trash::move_to_trash(&p)
            }
        })
        .collect())
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let data_dir = crate::store::data_dir();
    std::fs::create_dir_all(&data_dir).expect("create data dir");
    let db = Arc::new(Db::open(&data_dir.join("db.sqlite")).expect("open db"));
    let blobs = Arc::new(BlobStore::new(data_dir.join("blobs")));
    let watcher = Arc::new(crate::watcher::WatcherManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState {
            db: db.clone(),
            blobs: blobs.clone(),
            watcher: watcher.clone(),
        })
        .manage(crate::memory::OpenAllow::default())
        .manage(crate::cleanup::ScanState::default())
        // Tests for this module live at the bottom of the file (see `#[cfg(test)] mod tests`).
        .invoke_handler(tauri::generate_handler![
            list_edits,
            get_edit,
            get_edit_diff,
            accept_edit,
            reject_edit,
            rollback_edit,
            explain_edit,
            get_settings,
            update_settings,
            toggle_pause,
            list_projects,
            add_project,
            remove_project,
            touch_project,
            accept_all,
            reject_all,
            crate::sessions::sessions_refresh,
            crate::sessions::sessions_list,
            session_trash,
            memory_list,
            memory_open_file,
            crate::plans::plans_tree,
            crate::plans::plans_change,
            crate::plans::plans_read,
            crate::cleanup::cleanup_scan,
            crate::cleanup::cleanup_trash,
            settings_learning_toggle,
        ])
        .setup(move |app| {
            crate::hook::start_watcher(app.handle().clone(), db.clone());
            maintenance::spawn_retention_task(db.clone());
            if let Err(e) = watcher.start_all(app.handle().clone(), db.clone(), blobs.clone()) {
                tracing::warn!("watcher start_all err: {}", e);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run tauri");
}

#[cfg(test)]
mod tests {
    //! Unit tests for `app.rs` are intentionally placeholders.
    //!
    //! Every `#[tauri::command]` in this module takes `tauri::State<AppState>`
    //! as one of its parameters. `State<T>` is constructed by Tauri's runtime
    //! during `Builder::manage`; the public API does NOT expose a constructor
    //! that lets a unit test fabricate `State<AppState>` without standing up
    //! a full Tauri runtime. Attempting to do so would test Tauri's plumbing
    //! rather than our business logic.
    //!
    //! What each command actually does is a thin adapter that:
    //!   1. Unwraps `State<AppState>` to access `db`, `blobs`, `watcher`.
    //!   2. Delegates to a module that IS unit-tested directly:
    //!        - `db::*`        — covered by `db.rs` tests.
    //!        - `rollback::*`  — covered by `rollback.rs` tests.
    //!        - `settings::*`  — covered by `settings.rs` tests.
    //!        - `explain::*`   — covered by `explain.rs` tests.
    //!   3. Maps `anyhow::Error` to `String` via `.map_err(|e| e.to_string())`.
    //!
    //! The map-to-string conversion is mechanical; the meaningful behaviour
    //! lives in the delegated modules. Adding an `AppState` mock here would
    //! duplicate that coverage without adding a single new assertion.
    //!
    //! Tauri command integration is exercised end-to-end by the playwright +
    //! manual smoke tests; that scope belongs in the `test` agent's matrix,
    //! not in cargo unit tests.

    use crate::test_support::test_state;

    #[test]
    fn app_state_constructs_via_test_fixture() {
        // Sanity check: the shared test fixture really does produce a usable
        // `AppState` (db open, blobs writable, watcher initialised). Any
        // future Tauri command test will rely on this fixture, so a failure
        // here surfaces a fixture regression rather than a command regression.
        let fx = test_state();
        // db is queryable
        let _ = fx.state.db.list_projects().expect("db list_projects");
        // blobs is writable
        let sha = fx
            .state
            .blobs
            .store_bytes(b"unit-test-payload")
            .expect("blobs store_bytes");
        assert!(!sha.is_empty(), "store_bytes must return a sha");
        // watcher is constructed (no panics, no extra assertions; presence
        // alone is the contract since real fs notify is not driven in tests).
        let _watcher = fx.state.watcher.clone();
    }

    /// The commands registered in `generate_handler!` are exactly the kept ones.
    /// The list is read from this file's own source because the macro cannot be
    /// introspected at run time.
    fn registered_names() -> Vec<String> {
        let src = include_str!("app.rs");
        let start = src.find("generate_handler![").expect("handler list");
        let rest = &src[start + "generate_handler![".len()..];
        let end = rest.find("])").expect("end of handler list");
        let mut names: Vec<String> = rest[..end]
            .lines()
            .map(|l| l.trim().trim_end_matches(',').trim())
            .filter(|l| !l.is_empty() && !l.starts_with("//"))
            .map(|l| l.rsplit("::").next().unwrap().to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn handler_list_holds_exactly_the_registered_commands() {
        let mut want: Vec<String> = [
            "list_edits",
            "get_edit",
            "get_edit_diff",
            "accept_edit",
            "reject_edit",
            "rollback_edit",
            "explain_edit",
            "get_settings",
            "update_settings",
            "toggle_pause",
            "settings_learning_toggle",
            "accept_all",
            "reject_all",
            "list_projects",
            "add_project",
            "remove_project",
            "touch_project",
            "sessions_refresh",
            "sessions_list",
            "session_trash",
            "memory_list",
            "memory_open_file",
            "plans_tree",
            "plans_change",
            "plans_read",
            "cleanup_scan",
            "cleanup_trash",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        want.sort();
        assert_eq!(registered_names().len(), 27);
        assert_eq!(registered_names(), want);
    }

    /// `list_edits` hands the renderer rows with source and decision.
    #[test]
    fn list_edits_returns_labeled_rows() {
        use super::{list_edits, AppState, EditFilter};
        use tauri::State;
        type ListEditsFn =
            fn(Option<EditFilter>, State<AppState>) -> Result<Vec<crate::db::LabeledEdit>, String>;
        fn takes(_: ListEditsFn) {}
        takes(list_edits);
        let fx = test_state();
        let rows = fx
            .state
            .db
            .list_edits_labeled(EditFilter::default())
            .expect("labelled list on a fresh schema");
        assert!(rows.is_empty());
    }
}
