use anyhow::{Context, Result};
use directories::UserDirs;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn data_dir() -> PathBuf {
    // Test-only escape hatch: allow integration tests + CI to redirect data_dir
    // away from the real user profile via env var. Real users never set this.
    if let Ok(custom) = std::env::var("CLAUDE_MANAGER_DATA_DIR") {
        return PathBuf::from(custom);
    }
    if let Some(dir) = default_data_dir() {
        return dir;
    }
    let home = directories::UserDirs::new()
        .map(|d| d.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".claude-manager")
}

/// Platform data folder for the bundle identifier `io.github.theanh1810.claude-manager`.
/// Pure (reads no env var) so tests can check it without racing other tests.
fn default_data_dir() -> Option<PathBuf> {
    directories::ProjectDirs::from("io.github", "theanh1810", "claude-manager")
        .map(|proj| proj.data_dir().to_path_buf())
}

pub struct BlobStore {
    root: PathBuf,
}

impl BlobStore {
    pub fn new(root: PathBuf) -> Self {
        fs::create_dir_all(&root).ok();
        Self { root }
    }

    pub fn store_bytes(&self, content: &[u8]) -> Result<String> {
        let sha = sha256_hex(content);
        let path = self.path_for(&sha);
        if path.exists() {
            return Ok(sha);
        }
        fs::create_dir_all(path.parent().unwrap())?;
        let tmp = path.with_extension("tmp");
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(content)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &path)?;
        Ok(sha)
    }

    pub fn store_file(&self, src: &Path) -> Result<String> {
        let bytes = fs::read(src).with_context(|| format!("read {}", src.display()))?;
        self.store_bytes(&bytes)
    }

    pub fn read_bytes(&self, sha: &str) -> Result<Vec<u8>> {
        fs::read(self.path_for(sha)).with_context(|| format!("read blob {}", sha))
    }

    pub fn read_string(&self, sha: &str) -> Result<String> {
        let bytes = self.read_bytes(sha)?;
        String::from_utf8(bytes).map_err(|e| anyhow::anyhow!("invalid utf-8: {}", e))
    }

    pub fn restore_to(&self, sha: &str, dest: &Path) -> Result<()> {
        let bytes = self.read_bytes(sha)?;
        let (Some(parent), Some(_)) = (dest.parent(), dest.file_name()) else {
            anyhow::bail!("cannot restore to {}", dest.display());
        };
        fs::create_dir_all(parent)?;
        // Random name, opened with O_EXCL: a link planted at a guessable name is never followed. The name stays
        // short (52 bytes) whatever dest is called; the leading dot and the `.tmp` ending keep the watcher blind
        // to it. Unix: the temp is created 0600 and, when dest is a regular file, takes its permission bits
        // (fchmod on the handle, before the rename), so a 0600 `.env` or a 0755 script keeps its mode.
        let tmp = parent.join(format!(
            ".{}.claude-manager.tmp",
            uuid::Uuid::new_v4().simple()
        ));
        #[cfg(unix)]
        let keep = fs::symlink_metadata(dest)
            .ok()
            .filter(|m| m.is_file())
            .map(|m| m.permissions());
        let written = (|| -> std::io::Result<()> {
            let mut opts = fs::OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]
            std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
            let mut f = opts.open(&tmp)?;
            f.write_all(&bytes)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(keep) = &keep {
                    f.set_permissions(fs::Permissions::from_mode(keep.mode() & 0o777))?;
                }
            }
            f.sync_all()?;
            fs::rename(&tmp, dest)
        })();
        if let Err(e) = written {
            let _ = fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(())
    }

    fn path_for(&self, sha: &str) -> PathBuf {
        let (a, b) = sha.split_at(2);
        self.root.join(a).join(format!("{}.bin", b))
    }
}

pub fn sha256_hex(content: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(content);
    hex::encode(h.finalize())
}

/// Replace the user's home directory in an error message by `~`, so absolute
/// paths do not leak to the renderer or the IPC logs. No-op when the home
/// directory cannot be resolved or the message does not contain it.
pub(crate) fn mask_err<E: std::fmt::Display>(err: E) -> String {
    let s = err.to_string();
    if let Some(dirs) = UserDirs::new() {
        if let Some(home) = dirs.home_dir().to_str() {
            if !home.is_empty() && s.contains(home) {
                return s.replace(home, "~");
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn default_data_dir_uses_reverse_dns_identifier_on_macos() {
        let dir = default_data_dir().expect("home directory available");
        assert!(
            dir.ends_with("Library/Application Support/io.github.theanh1810.claude-manager"),
            "unexpected data dir: {}",
            dir.display()
        );
    }

    use super::*;
    // Use tempfile::TempDir so each test gets a unique dir (one per call).
    // Older approach shared a PID-named dir across tests which races under
    // parallel `cargo test` execution: test A removes-then-creates while
    // test B is mid-write, surfacing as "No such file or directory" panics.
    use tempfile::TempDir;

    /// Returns a fresh tempdir scoped to a single test. Drop = cleanup.
    fn tmp_root() -> TempDir {
        TempDir::new().unwrap()
    }

    #[test]
    fn sha256_known_vector() {
        assert_eq!(
            sha256_hex(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn blob_store_dedup() {
        let tmp = tmp_root();
        let root = tmp.path().join("blobs");
        let store = BlobStore::new(root.clone());
        let s1 = store.store_bytes(b"hello world").unwrap();
        let s2 = store.store_bytes(b"hello world").unwrap();
        assert_eq!(s1, s2);
        let count = fs::read_dir(root.join(&s1[..2])).unwrap().count();
        assert_eq!(count, 1);
    }

    #[test]
    fn blob_store_read_roundtrip() {
        let tmp = tmp_root();
        let root = tmp.path().join("blobs");
        let store = BlobStore::new(root);
        let content = "Xin chào Việt Nam";
        let sha = store.store_bytes(content.as_bytes()).unwrap();
        let back = store.read_string(&sha).unwrap();
        assert_eq!(back, content);
    }

    #[test]
    fn blob_store_restore_to() {
        let tmp = tmp_root();
        let root = tmp.path();
        let store = BlobStore::new(root.join("blobs"));
        let sha = store.store_bytes(b"snapshot v1").unwrap();
        let target = root.join("subdir").join("file.txt");
        store.restore_to(&sha, &target).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "snapshot v1");
    }

    /// `<tmp>/project/README.md` (= "new"), `<tmp>/outside/victim` (= "orig") and a store holding "old".
    #[cfg(unix)]
    fn restore_fixture(tmp: &TempDir) -> (BlobStore, String, PathBuf, PathBuf) {
        let project = tmp.path().join("project");
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(project.join("README.md"), "new").unwrap();
        fs::write(outside.join("victim"), "orig").unwrap();
        let store = BlobStore::new(tmp.path().join("blobs"));
        let sha = store.store_bytes(b"old").unwrap();
        (store, sha, project, outside)
    }

    #[cfg(unix)]
    #[test]
    fn restore_to_never_writes_through_a_link_planted_beside_dest() {
        use std::os::unix::fs::symlink;
        let tmp = tmp_root();
        let (store, sha, project, outside) = restore_fixture(&tmp);
        let dest = project.join("README.md");
        let planted = project.join("README.claude-manager.tmp");
        for target in [outside.join("victim"), outside.join("created")] {
            symlink(&target, &planted).unwrap();
            store.restore_to(&sha, &dest).unwrap();
            assert_eq!(
                fs::read_to_string(outside.join("victim")).unwrap(),
                "orig",
                "{target:?}"
            );
            assert!(!outside.join("created").exists(), "{target:?}");
            assert!(fs::symlink_metadata(&dest).unwrap().is_file(), "{target:?}");
            assert_eq!(fs::read_to_string(&dest).unwrap(), "old", "{target:?}");
            let _ = fs::remove_file(&planted);
            fs::write(&dest, "new").unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn restore_to_replaces_a_link_at_dest_with_a_regular_file() {
        let tmp = tmp_root();
        let (store, sha, project, outside) = restore_fixture(&tmp);
        let dest = project.join("linked.md");
        std::os::unix::fs::symlink(outside.join("victim"), &dest).unwrap();
        store.restore_to(&sha, &dest).unwrap();
        assert!(fs::symlink_metadata(&dest).unwrap().is_file());
        assert_eq!(fs::read_to_string(&dest).unwrap(), "old");
        assert_eq!(fs::read_to_string(outside.join("victim")).unwrap(), "orig");
    }

    #[cfg(unix)]
    #[test]
    fn restore_to_leaves_no_temp_file() {
        let tmp = tmp_root();
        let (store, sha, project, _outside) = restore_fixture(&tmp);
        store.restore_to(&sha, &project.join("README.md")).unwrap();
        let names: Vec<_> = fs::read_dir(&project)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("README.md")]);
    }

    #[cfg(unix)]
    #[test]
    fn restore_to_a_250_byte_file_name() {
        let tmp = tmp_root();
        let (store, sha, project, _outside) = restore_fixture(&tmp);
        let name = "a".repeat(246) + ".txt";
        let dest = project.join(&name);
        fs::write(&dest, "new").unwrap();

        store.restore_to(&sha, &dest).unwrap();

        assert_eq!(fs::read_to_string(&dest).unwrap(), "old");
        let names: Vec<_> = fs::read_dir(&project)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .filter(|n| n != "README.md")
            .collect();
        assert_eq!(names, vec![name]);
    }

    #[cfg(unix)]
    #[test]
    fn restore_keeps_the_permission_bits_of_the_file_it_replaces() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tmp_root();
        let (store, sha, project, _outside) = restore_fixture(&tmp);
        for (name, mode) in [(".env", 0o600), ("run.sh", 0o755)] {
            let dest = project.join(name);
            fs::write(&dest, "new").unwrap();
            fs::set_permissions(&dest, fs::Permissions::from_mode(mode)).unwrap();

            store.restore_to(&sha, &dest).unwrap();

            assert_eq!(fs::read_to_string(&dest).unwrap(), "old", "{name}");
            let got = fs::metadata(&dest).unwrap().permissions().mode() & 0o777;
            assert_eq!(got, mode, "{name}: {got:o}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn restore_of_a_missing_file_creates_it_0600() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tmp_root();
        let (store, sha, project, _outside) = restore_fixture(&tmp);
        let dest = project.join("gone.md");

        store.restore_to(&sha, &dest).unwrap();

        assert_eq!(fs::read_to_string(&dest).unwrap(), "old");
        assert_eq!(
            fs::metadata(&dest).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn mask_err_replaces_the_home_directory() {
        let home = UserDirs::new()
            .and_then(|d| d.home_dir().to_str().map(|s| s.to_string()))
            .expect("home dir");
        assert_eq!(
            mask_err(format!("cannot read {home}/x.jsonl")),
            "cannot read ~/x.jsonl"
        );
        assert_eq!(mask_err("no path here"), "no path here");
    }
}
