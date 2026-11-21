use crate::db::Db;
use crate::settings;
use crate::store::data_dir;
use std::path::Path;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tracing::{info, warn};

pub fn spawn_retention_task(db: Arc<Db>) {
    thread::spawn(move || {
        // Run once on startup so freshly launched apps don't wait an hour
        // to sweep orphan blobs accumulated since the previous session.
        if let Err(e) = run_once(&db) {
            warn!("retention cleanup error: {}", e);
        }
        loop {
            thread::sleep(Duration::from_secs(3600));
            if let Err(e) = run_once(&db) {
                warn!("retention cleanup error: {}", e);
            }
        }
    });
}

fn run_once(db: &Db) -> anyhow::Result<()> {
    let s = settings::get_all(db)?;
    let removed = db.cleanup_old_blobs(s.retention_days)?;
    if removed > 0 {
        info!("retention: removed {} old blob records", removed);
    }
    // Always sweep orphan files. The prior gate `if removed > 0`
    // never fired because the `blobs` metadata table is unused
    // (BlobStore writes files without inserting rows), so
    // cleanup_old_blobs returns 0 forever and pruning never ran —
    // orphan blob files accumulated indefinitely.
    let blobs_root = data_dir().join("blobs");
    let pruned = prune_orphan_files(db, &blobs_root)?;
    if pruned > 0 {
        info!("retention: removed {} orphan blob files", pruned);
    }
    Ok(())
}

fn prune_orphan_files(db: &Db, blobs_root: &Path) -> anyhow::Result<usize> {
    if !blobs_root.exists() {
        return Ok(0);
    }
    let valid = db.all_blob_shas()?;
    let mut removed = 0;
    for entry in walkdir::WalkDir::new(blobs_root).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Some(name) = entry.path().file_stem().and_then(|s| s.to_str()) {
                let prefix = entry
                    .path()
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                let sha = format!("{}{}", prefix, name);
                if !valid.contains(&sha) && std::fs::remove_file(entry.path()).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::Edit;
    use crate::store::BlobStore;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Db, BlobStore) {
        let tmp = TempDir::new().unwrap();
        let db = Db::open(&tmp.path().join("db.sqlite")).unwrap();
        let store = BlobStore::new(tmp.path().join("blobs"));
        (tmp, db, store)
    }

    fn edit_with_after(id: &str, after_sha: &str) -> Edit {
        Edit {
            id: id.to_string(),
            session_id: None,
            tool: "Edit".to_string(),
            path: "/x".to_string(),
            before_blob_sha: None,
            after_blob_sha: after_sha.to_string(),
            status: "pending".to_string(),
            hook_phase: "pre".to_string(),
            created_at: "2026-07-14T00:00:00Z".to_string(),
            decided_at: None,
            explanation_md: None,
            explanation_cached_at: None,
            rollback_of_edit_id: None,
        }
    }

    #[test]
    fn prune_removes_orphan_and_keeps_referenced() {
        let (tmp, db, store) = setup();
        let kept_sha = store.store_bytes(b"referenced").unwrap();
        let orphan_sha = store.store_bytes(b"orphan").unwrap();
        db.insert_edit(&edit_with_after("e1", &kept_sha)).unwrap();

        let blobs_root = tmp.path().join("blobs");
        let removed = prune_orphan_files(&db, &blobs_root).unwrap();

        assert_eq!(removed, 1);
        assert!(blobs_root
            .join(&kept_sha[..2])
            .join(format!("{}.bin", &kept_sha[2..]))
            .exists());
        assert!(!blobs_root
            .join(&orphan_sha[..2])
            .join(format!("{}.bin", &orphan_sha[2..]))
            .exists());
    }

    #[test]
    fn prune_noop_when_all_referenced() {
        let (tmp, db, store) = setup();
        let sha = store.store_bytes(b"only-one").unwrap();
        db.insert_edit(&edit_with_after("e1", &sha)).unwrap();

        let removed = prune_orphan_files(&db, &tmp.path().join("blobs")).unwrap();
        assert_eq!(removed, 0);
    }

    #[test]
    fn prune_returns_zero_when_dir_missing() {
        let (tmp, db, _) = setup();
        let removed = prune_orphan_files(&db, &tmp.path().join("does-not-exist")).unwrap();
        assert_eq!(removed, 0);
    }
}
