use crate::db::Db;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tracing::info;

pub fn start_watcher(app: AppHandle, db: Arc<Db>) {
    std::thread::spawn(move || {
        if let Err(e) = run_watcher(app, db) {
            tracing::error!("watcher exit: {}", e);
        }
    });
}

fn run_watcher(app: AppHandle, _db: Arc<Db>) -> anyhow::Result<()> {
    let data_dir = crate::store::data_dir();
    let db_path = data_dir.join("db.sqlite");
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(tx)?;
    watcher.watch(&db_path, RecursiveMode::NonRecursive)?;
    info!("watching {}", db_path.display());

    for event in rx {
        match event {
            Ok(_) => {
                let _ = app.emit("edits-changed", ());
            }
            Err(e) => tracing::warn!("watch err: {}", e),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! Tests for `hook.rs` are intentionally minimal.
    //!
    //! This module exposes exactly one symbol — `start_watcher` — and its body
    //! is a thread spawn that runs `run_watcher`. `run_watcher` is itself a
    //! tight wrapper around three side effects we cannot fabricate in a unit
    //! test:
    //!   1. `crate::store::data_dir()` — reads the OS-level app-data path;
    //!   2. `notify::recommended_watcher` — real filesystem watcher backed by
    //!      kqueue / inotify / FSEvents;
    //!   3. `tauri::AppHandle::emit` — requires a live Tauri runtime.
    //!
    //! There are no pure helpers in this file. Adding a
    //! fake `AppHandle` solely to drive `run_watcher` would test mock plumbing
    //! rather than production behaviour, so we defer to an integration test
    //! once a real handler exists.
    //!
    //! Placeholder retained so coverage tooling records the module and so a
    //! future contributor sees the explicit rationale before adding noise.

    #[test]
    fn hook_module_has_no_unit_testable_pure_helpers() {
        // Sentinel: if a pure helper is later extracted from `run_watcher`
        // (e.g. a `db_path()` resolver), replace this with real coverage and
        // remove the placeholder.
    }
}
