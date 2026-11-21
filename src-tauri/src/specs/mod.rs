//! Read-only helpers for the plan files of a registered project: the summaries of tasks, review rounds and
//! test rounds, and the checked read of one file. Nothing here writes.

pub mod errors;
pub mod plan_files;
pub mod reader;

use crate::db::Db;
use crate::store::mask_err;
use std::path::PathBuf;

/// The root of a registered project; any other path is refused.
pub(crate) fn registered_project_root(db: &Db, project: &str) -> Result<PathBuf, String> {
    db.list_projects()
        .map_err(mask_err)?
        .into_iter()
        .find(|p| p.path == project)
        .map(|p| PathBuf::from(p.path))
        .ok_or_else(|| "unknown project".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::Project;
    use crate::test_support::test_state;

    #[test]
    fn only_a_registered_project_resolves() {
        let fx = test_state();
        fx.state
            .db
            .insert_project(&Project {
                id: "p1".into(),
                name: "demo".into(),
                path: "/tmp/demo".into(),
                color: None,
                added_at: "2026-10-01T00:00:00Z".into(),
                last_opened_at: None,
            })
            .unwrap();
        assert_eq!(
            registered_project_root(&fx.state.db, "/tmp/demo").unwrap(),
            PathBuf::from("/tmp/demo")
        );
        assert!(registered_project_root(&fx.state.db, "/etc").is_err());
        assert!(registered_project_root(&fx.state.db, "/tmp/demo/../../etc").is_err());
    }

    #[test]
    fn an_unregistered_project_is_refused() {
        let fx = test_state();
        assert_eq!(
            registered_project_root(&fx.state.db, "/etc").unwrap_err(),
            "unknown project"
        );
        assert!(registered_project_root(&fx.state.db, "/tmp/demo/../../etc").is_err());
    }
}
