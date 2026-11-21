//! Move one path to the macOS Trash. Never a permanent delete: when the Trash
//! move fails the entry stays where it is and the error is returned.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TrashResult {
    pub path: String,
    pub ok: bool,
    /// The path was already gone when asked; not an error.
    pub gone: bool,
    pub error: Option<String>,
}

impl TrashResult {
    pub fn rejected(path: &str, why: &str) -> Self {
        Self {
            path: path.to_string(),
            ok: false,
            gone: false,
            error: Some(why.to_string()),
        }
    }
}

fn delete(path: &Path) -> Result<(), trash::Error> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(path)
}

/// Trash `path`; a missing path reports `gone`.
pub fn move_to_trash(path: &Path) -> TrashResult {
    let shown = path.to_string_lossy().to_string();
    match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return TrashResult {
                path: shown,
                ok: true,
                gone: true,
                error: None,
            };
        }
        Err(e) => return TrashResult::rejected(&shown, &e.to_string()),
        Ok(_) => {}
    }
    match delete(path) {
        Ok(()) => TrashResult {
            path: shown,
            ok: true,
            gone: false,
            error: None,
        },
        Err(e) => TrashResult::rejected(&shown, &e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_path_reports_gone_without_an_error() {
        let r = move_to_trash(Path::new("/tmp/claude-manager-no-such-entry-xyz"));
        assert!(r.ok && r.gone && r.error.is_none());
    }
}
