-- 004: the session-history index and the labels of recorded changes (claude-manager-refocus).
-- Migrations run on every open and there is no version table, so every
-- statement is IF NOT EXISTS. Rolling the code back leaves these tables unused.

-- One row per Claude Code transcript file: how far it has been read.
CREATE TABLE IF NOT EXISTS transcript_files (
    path TEXT PRIMARY KEY,
    project_dir TEXT,
    session_id TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    read_offset INTEGER NOT NULL DEFAULT 0,
    malformed_lines INTEGER NOT NULL DEFAULT 0
);

-- Only the four allowed facts of an Edit, Write or NotebookEdit call plus its
-- permission decision. No prompt, answer or tool output is stored here.
CREATE TABLE IF NOT EXISTS tool_calls (
    tool_use_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    transcript_path TEXT NOT NULL,
    tool TEXT NOT NULL,
    file_path TEXT NOT NULL,
    ts INTEGER NOT NULL,
    decision TEXT,
    decision_source TEXT,
    denial_kind TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_file_ts ON tool_calls(file_path, ts);
CREATE INDEX IF NOT EXISTS idx_tool_calls_transcript ON tool_calls(transcript_path);

-- The label of a recorded change, written when it is matched so it survives
-- a transcript later moved to the Trash. edit_id is the edits.id (TEXT).
CREATE TABLE IF NOT EXISTS edit_labels (
    edit_id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('claude', 'unknown')),
    session_id TEXT,
    tool_use_id TEXT,
    decision TEXT,
    matched_at INTEGER NOT NULL
);
