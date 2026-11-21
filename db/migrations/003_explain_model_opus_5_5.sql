-- 003: the explain_model default moves from claude-opus-4-8 to claude-opus-5-5.
-- Only the exact old default is rewritten: a value the user chose (any other
-- model id) is kept. 001 still seeds claude-opus-4-8 and runs on every open;
-- this statement then moves that seed on the same open. Forward-only and
-- idempotent: once the row holds claude-opus-5-5 the WHERE no longer matches.
UPDATE settings
SET value_json = '"claude-opus-5-5"', updated_at = datetime('now')
WHERE key = 'explain_model'
  AND value_json = '"claude-opus-4-8"';
