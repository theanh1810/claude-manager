---
sdd_adopted: 2026-10-21
scope: partial
modules_in_scope:
  # (1) Review of Claude's file changes: accept, reject, roll back (capability review-changes)
  - src/features/edits
  - src-tauri/src/rollback.rs
  - src-tauri/src/explain.rs
  - src-tauri/src/watcher.rs
  # (2) Memory and recorded errors (capability memory-and-errors)
  - src/features/memory
  - src-tauri/src/memory
  # (3) Plans: agent-hub plan folders, read only (capability plan-tracking)
  - src/features/plans
  - src-tauri/src/specs
  # (4) Sessions and cleanup of ~/.claude (capabilities sessions, storage-cleanup)
  - src/features/sessions
  - src-tauri/src/sessions
  - src-tauri/src/cleanup
---

# Scope

Carried from the adoption block of the project spec index (adopted 2026-10-21, scope partial, the four areas chosen by the user on 2026-10-21) by change `claude-manager-openspec-reader`, which removes `src-tauri/src/plan_comments_cmd.rs` from area (3).

## Not in the spec layer

| Module | Why |
|---|---|
| `src/features/settings`, `src-tauri/src/settings.rs` | kept but outside the four areas; widen scope when Settings changes behaviour |
| `db/migrations`, `src-tauri/src/{db.rs, app.rs, main.rs, store.rs, maintenance.rs}` | shared infrastructure, not a business flow |
