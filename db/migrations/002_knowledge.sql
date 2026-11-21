-- claude-manager: knowledge base + practice + plan comments schema.
-- Idempotent (safe to re-run) — every DDL uses IF NOT EXISTS.
-- FTS5 available in rusqlite feature 'bundled' (rusqlite 0.32 enables SQLITE_ENABLE_FTS5 by default).

-- INVARIANT: do NOT run VACUUM on this DB.
-- kb_entries.id is TEXT PK; kb_fts sync uses SQLite rowid.
-- VACUUM would reassign non-INTEGER-PK rowids, breaking kb_fts sync.

-- Knowledge entries. body_md lives on disk at
-- ~/.claude-manager/knowledge/<slug>/<id>.md; only metadata + checksum here.
CREATE TABLE IF NOT EXISTS kb_entries (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    source_ref TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    checksum TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (source IN ('session', 'review', 'plan', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_kb_entries_updated ON kb_entries(updated_at DESC);

-- FTS5 standalone table: body_md is not stored in kb_entries,
-- so ingest code (W2-T2a) writes to both tables using kb_entries.rowid.
-- Standalone chosen over external-content because body source-of-truth is disk.
CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Keep kb_fts in sync when a kb_entries row is deleted. Insert/update sync is
-- handled by ingest code because body_md is not present on kb_entries.
CREATE TRIGGER IF NOT EXISTS kb_entries_ad AFTER DELETE ON kb_entries BEGIN
    DELETE FROM kb_fts WHERE rowid = old.rowid;
END;

-- Practice decks + spaced-repetition cards.
CREATE TABLE IF NOT EXISTS practice_decks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_cards (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    front_md TEXT NOT NULL,
    back_md TEXT NOT NULL,
    interval_days INTEGER NOT NULL DEFAULT 1,
    next_review_at TEXT NOT NULL,
    ease REAL NOT NULL DEFAULT 2.5,
    streak INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (deck_id) REFERENCES practice_decks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_practice_cards_deck ON practice_cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_practice_cards_due ON practice_cards(next_review_at);

-- plan_comments mirrors comments.jsonl on disk for fast query. jsonl remains
-- source-of-truth; this table is a read-optimised projection.
CREATE TABLE IF NOT EXISTS plan_comments (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    task_id TEXT,
    line_ref TEXT,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    suggestion_json TEXT,
    ts TEXT NOT NULL,
    CHECK (author IN ('user', 'analyst', 'reviewer', 'planner'))
);

CREATE INDEX IF NOT EXISTS idx_plan_comments_plan ON plan_comments(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_comments_ts ON plan_comments(ts DESC);
