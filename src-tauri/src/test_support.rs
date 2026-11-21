//! Test-only fixtures shared across the rust unit test suite.
//!
//! Provides an isolated `AppState` backed by:
//! - a tempfile-based SQLite DB (so each test gets a fresh schema)
//! - a tempfile-based blob store (so blob writes do not bleed across tests)
//! - a no-op `WatcherManager` (real fs notify is not exercised in unit tests)
//!
//! Gated on `#[cfg(test)]` so it is excluded from release binaries.

#![cfg(test)]

use crate::app::AppState;
use crate::db::Db;
use crate::store::BlobStore;
use crate::watcher::WatcherManager;
use std::sync::Arc;
use tempfile::TempDir;

/// Owned test fixture. The `TempDir` is held inside so the on-disk DB + blob
/// files live exactly as long as the `AppState`. Drop the fixture → cleanup.
pub struct TestState {
    pub state: AppState,
    // Kept alive so the directory is not removed mid-test.
    pub _tmp: TempDir,
}

/// Build a fully-isolated `AppState` for a single test. Each call returns a
/// fresh tempdir; tests do not share state.
pub fn test_state() -> TestState {
    let tmp = TempDir::new().expect("create tempdir");
    let db_path = tmp.path().join("db.sqlite");
    let blobs_root = tmp.path().join("blobs");

    let db = Arc::new(Db::open(&db_path).expect("open sqlite"));
    let blobs = Arc::new(BlobStore::new(blobs_root));
    let watcher = Arc::new(WatcherManager::new());

    TestState {
        state: AppState { db, blobs, watcher },
        _tmp: tmp,
    }
}
