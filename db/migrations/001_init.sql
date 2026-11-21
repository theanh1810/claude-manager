-- claude-manager initial schema
-- SQLite. Run on first start. WAL mode set by app on connect.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    claude_session_id TEXT,
    project_path TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_claude_id ON sessions(claude_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);

CREATE TABLE IF NOT EXISTS edits (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    tool TEXT NOT NULL,
    path TEXT NOT NULL,
    before_blob_sha TEXT,
    after_blob_sha TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    hook_phase TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    explanation_md TEXT,
    explanation_cached_at TEXT,
    rollback_of_edit_id TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (rollback_of_edit_id) REFERENCES edits(id) ON DELETE SET NULL,
    CHECK (status IN ('pending', 'pending_decision', 'accepted', 'rejected', 'rolled_back', 'auto_accepted'))
);

CREATE INDEX IF NOT EXISTS idx_edits_session ON edits(session_id);
CREATE INDEX IF NOT EXISTS idx_edits_path ON edits(path);
CREATE INDEX IF NOT EXISTS idx_edits_status ON edits(status);
CREATE INDEX IF NOT EXISTS idx_edits_created ON edits(created_at DESC);

CREATE TABLE IF NOT EXISTS blobs (
    sha256 TEXT PRIMARY KEY,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    ref_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_blobs_last_used ON blobs(last_used_at);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES
    ('mode', '"observer"', datetime('now')),
    ('paused', 'false', datetime('now')),
    ('retention_days', '30', datetime('now')),
    ('interactive_timeout_sec', '60', datetime('now')),
    ('hybrid_rules', '{"gate_paths":[],"auto_paths":[]}', datetime('now')),
    ('anthropic_api_key', '""', datetime('now')),
    ('explain_model', '"claude-opus-4-8"', datetime('now')),
    ('autostart', 'false', datetime('now'));

-- One-shot model upgrade for existing installs (idempotent)
UPDATE settings
SET value_json = '"claude-opus-4-8"', updated_at = datetime('now')
WHERE key = 'explain_model'
  AND value_json IN ('"claude-haiku-4-5-20251001"', '"claude-sonnet-4-6"');

CREATE TABLE IF NOT EXISTS pre_snapshots (
    path TEXT PRIMARY KEY,
    blob_sha TEXT NOT NULL,
    session_id TEXT,
    captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pre_snapshots_captured ON pre_snapshots(captured_at);

CREATE TABLE IF NOT EXISTS watched_files (
    project_id TEXT NOT NULL,
    path TEXT NOT NULL,
    blob_sha TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_watched_files_project ON watched_files(project_id);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    color TEXT,
    added_at TEXT NOT NULL,
    last_opened_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
