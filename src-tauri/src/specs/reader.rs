//! Reads one plan file of a registered project with a size cap and a boundary check. Read only.

use std::fs::File;
use std::io::{self, Read};
use std::path::{Component, Path};

const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Whether `f`, already open, is the file `path` names once links are followed, and that file lies inside `base`
/// (a canonical folder). Opening first and comparing the handle with the path closes the gap between a check by
/// path and a read by path, in which the path could be pointed somewhere else. Unix compares device and inode;
/// other platforms only check the prefix.
pub(crate) fn check_opened(f: &File, path: &Path, base: &Path) -> io::Result<bool> {
    let real = path.canonicalize()?;
    if !real.starts_with(base) {
        return Ok(false);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let (named, opened) = (std::fs::metadata(&real)?, f.metadata()?);
        Ok((named.dev(), named.ino()) == (opened.dev(), opened.ino()))
    }
    #[cfg(not(unix))]
    {
        let _ = f;
        Ok(true)
    }
}

/// `path` opened for reading, or `None` when it names a file that is not a regular file or that leaves `base`
/// once links are followed. Nothing is opened before those checks, so a FIFO or an unreadable outside file is
/// never touched; a missing or dangling path stays an `Err(NotFound)`. The opened handle is then compared with
/// the path again (`check_opened`).
pub(crate) fn open_inside(path: &Path, base: &Path) -> io::Result<Option<File>> {
    let real = path.canonicalize()?;
    if !real.starts_with(base) || !std::fs::metadata(&real)?.is_file() {
        return Ok(None);
    }
    let f = File::open(&real)?;
    if !f.metadata()?.is_file() || !check_opened(&f, path, base)? {
        return Ok(None);
    }
    Ok(Some(f))
}

/// "file larger than 2 MiB" for a cap of whole MiB, else "file larger than {cap} bytes".
fn too_large(cap: u64) -> io::Error {
    const MIB: u64 = 1024 * 1024;
    let limit = if cap >= MIB && cap.is_multiple_of(MIB) {
        format!("{} MiB", cap / MIB)
    } else {
        format!("{cap} bytes")
    };
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("file larger than {limit}"),
    )
}

/// The bytes of `f`, refused as `InvalidData` when there are more than `cap`; the read itself is bounded too,
/// so a file that grows after the size check cannot fill memory.
pub(crate) fn read_capped(f: &File, cap: u64) -> io::Result<Vec<u8>> {
    if f.metadata()?.len() > cap {
        return Err(too_large(cap));
    }
    read_bounded(f, cap)
}

/// Up to `cap` bytes of `r`; one more byte than that is `InvalidData`.
fn read_bounded(r: impl Read, cap: u64) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    r.take(cap + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Err(too_large(cap));
    }
    Ok(bytes)
}

/// `read_capped` as text; bytes that are not UTF-8 are `InvalidData`.
pub(crate) fn read_handle_text(f: &File, cap: u64) -> io::Result<String> {
    String::from_utf8(read_capped(f, cap)?).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "stream did not contain valid UTF-8",
        )
    })
}

/// The text of one file under `root`; a path that leaves `root` is refused with "path outside {label}".
pub fn read_file_in(root: &Path, rel_path: &str, label: &str) -> Result<String, String> {
    let outside = || format!("path outside {label}");
    let p = Path::new(rel_path);
    if rel_path.is_empty()
        || p.is_absolute()
        || p.components().any(|c| matches!(c, Component::ParentDir))
    {
        return Err(outside());
    }
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    let Some(f) = open_inside(&base.join(p), &base).map_err(|e| e.to_string())? else {
        return Err(outside());
    };
    if !f.metadata().is_ok_and(|m| m.is_file()) {
        return Err(outside());
    }
    read_handle_text(&f, MAX_BYTES).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// `<tmp>/docs/changes/{moved/plan.vi.md, archive/2026-02-02-done/proposal.md}` with secrets beside it.
    fn fixture() -> TempDir {
        let d = TempDir::new().unwrap();
        for (rel, text) in [
            ("docs/changes/moved/plan.vi.md", "# Moved\n"),
            (
                "docs/changes/archive/2026-02-02-done/proposal.md",
                "# Done\n",
            ),
            ("docs/archives/x", "secret"),
            ("docs/brainstorm/x", "secret"),
            ("secret.txt", "secret"),
        ] {
            let p = d.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        }
        d
    }

    #[test]
    fn read_file_in_serves_a_file_under_the_root_and_refuses_what_leaves_it() {
        let d = fixture();
        let root = d.path().join("docs/changes");
        assert_eq!(
            read_file_in(&root, "moved/plan.vi.md", "docs/changes").unwrap(),
            "# Moved\n"
        );
        assert_eq!(
            read_file_in(&root, "archive/2026-02-02-done/proposal.md", "docs/changes").unwrap(),
            "# Done\n"
        );
        for bad in [
            "../archives/x",
            "../brainstorm/x",
            "/etc/passwd",
            "",
            "moved/../../archives/x",
            "../../secret.txt",
        ] {
            assert_eq!(
                read_file_in(&root, bad, "docs/changes").unwrap_err(),
                "path outside docs/changes",
                "{bad}"
            );
        }
        std::os::unix::fs::symlink(d.path().join("docs/archives/x"), root.join("link.md")).unwrap();
        assert_eq!(
            read_file_in(&root, "link.md", "docs/changes").unwrap_err(),
            "path outside docs/changes"
        );
    }

    #[test]
    fn a_handle_to_another_file_than_the_path_names_is_refused() {
        let d = fixture();
        let base = d.path().join("docs/changes").canonicalize().unwrap();
        let inside = base.join("moved/plan.vi.md");
        let outside = d.path().join("secret.txt");
        let other = std::fs::File::open(&outside).unwrap();
        assert!(!check_opened(&other, &inside, &base).unwrap());
        let same = std::fs::File::open(&inside).unwrap();
        assert!(check_opened(&same, &inside, &base).unwrap());
        assert!(!check_opened(&other, &outside, &base).unwrap());
        assert!(open_inside(&inside, &base).unwrap().is_some());
        assert!(open_inside(&outside, &base).unwrap().is_none());
    }

    #[test]
    fn a_read_over_the_cap_is_refused_and_bad_utf8_is_invalid_data() {
        let d = fixture();
        let big = d.path().join("big.txt");
        std::fs::write(&big, vec![b'a'; 11]).unwrap();
        let f = std::fs::File::open(&big).unwrap();
        assert_eq!(
            read_capped(&f, 10).unwrap_err().to_string(),
            "file larger than 10 bytes"
        );
        assert_eq!(read_capped(&f, 11).unwrap().len(), 11);
        let bad = d.path().join("bad.txt");
        std::fs::write(&bad, [0xff, 0xfe]).unwrap();
        let err = read_handle_text(&std::fs::File::open(&bad).unwrap(), 10).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(err.to_string(), "stream did not contain valid UTF-8");
    }

    #[test]
    fn a_stream_longer_than_the_cap_is_refused_even_when_the_size_check_passed() {
        let err = read_bounded(&b"01234567890"[..], 10).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
        assert_eq!(err.to_string(), "file larger than 10 bytes");
        assert_eq!(read_bounded(&b"0123456789"[..], 10).unwrap().len(), 10);
        assert_eq!(too_large(MAX_BYTES).to_string(), "file larger than 2 MiB");
    }

    #[test]
    fn a_folder_is_not_a_file() {
        let d = fixture();
        let root = d.path().join("docs/changes");
        assert_eq!(
            read_file_in(&root, "moved", "docs/changes").unwrap_err(),
            "path outside docs/changes"
        );
    }

    /// Runs `f` on a thread and fails the test when it does not return within 5 s (a blocked open of a FIFO).
    #[cfg(unix)]
    fn within_5s<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(f());
        });
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .expect("blocked for 5 s")
    }

    #[cfg(unix)]
    fn mkfifo(path: &Path) {
        let status = std::process::Command::new("mkfifo")
            .arg(path)
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_inside_the_base_is_refused_without_blocking() {
        let d = fixture();
        let root = d.path().join("docs/changes");
        mkfifo(&root.join("moved/pipe.md"));
        let base = root.canonicalize().unwrap();
        let pipe = base.join("moved/pipe.md");
        let b = base.clone();
        assert!(within_5s(move || open_inside(&pipe, &b)).unwrap().is_none());
        let msg = within_5s(move || read_file_in(&root, "moved/pipe.md", "docs/changes"));
        assert_eq!(msg.unwrap_err(), "path outside docs/changes");
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_fifo_outside_the_base_is_refused_without_blocking() {
        let d = fixture();
        let root = d.path().join("docs/changes");
        let outside = d.path().join("outside-pipe");
        mkfifo(&outside);
        std::os::unix::fs::symlink(&outside, root.join("link.md")).unwrap();
        let base = root.canonicalize().unwrap();
        let link = base.join("link.md");
        assert!(within_5s(move || open_inside(&link, &base))
            .unwrap()
            .is_none());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_an_unreadable_outside_file_reads_as_outside() {
        use std::os::unix::fs::PermissionsExt;
        let d = fixture();
        let root = d.path().join("docs/changes");
        let secret = d.path().join("secret.txt");
        std::fs::set_permissions(&secret, std::fs::Permissions::from_mode(0o000)).unwrap();
        std::os::unix::fs::symlink(&secret, root.join("link.md")).unwrap();
        let base = root.canonicalize().unwrap();
        assert!(open_inside(&base.join("link.md"), &base).unwrap().is_none());
        assert_eq!(
            read_file_in(&root, "link.md", "docs/changes").unwrap_err(),
            "path outside docs/changes"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_missing_or_dangling_path_stays_not_found() {
        let d = fixture();
        let root = d.path().join("docs/changes");
        std::os::unix::fs::symlink(d.path().join("gone"), root.join("dangling.md")).unwrap();
        let base = root.canonicalize().unwrap();
        for name in ["missing.md", "dangling.md"] {
            let err = open_inside(&base.join(name), &base).unwrap_err();
            assert_eq!(err.kind(), std::io::ErrorKind::NotFound, "{name}");
        }
    }

    #[test]
    fn the_module_has_no_write_call() {
        let src = include_str!("reader.rs");
        let body = &src[..src.find("#[cfg(test)]").unwrap()];
        for w in [
            "fs::write",
            "File::create",
            "create_dir",
            "remove_file",
            "OpenOptions",
        ] {
            assert!(!body.contains(w), "{w}");
        }
    }
}
