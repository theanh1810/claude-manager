# DESIGN — claude-manager

## Stack

- **Backend**: Rust + Tauri 2.x
- **Frontend**: React 18 + Vite + TypeScript + Tailwind + react-diff-viewer-continued
- **DB**: SQLite (rusqlite), WAL mode, blobs content-addressed on filesystem
- **State**: TanStack Query (server state) + Zustand (UI state)
- **IPC**: Tauri events (Rust → JS) + Tauri commands (JS → Rust)
- **Hook**: Single Rust binary `claude-manager` with subcommand `hook` invoked from `~/.claude/settings.json`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code                                             │
│    │                                                     │
│    │ tool: Edit / Write / NotebookEdit                   │
│    │                                                     │
│    ▼                                                     │
│  Hook (settings.json PostToolUse/PreToolUse)             │
│    │                                                     │
│    │ exec: claude-manager hook                           │
│    ▼                                                     │
│  CLI hook handler (Rust)                                 │
│    ├─ read settings (mode, paused, rules)                │
│    ├─ snapshot before/after → blob store                 │
│    ├─ insert edit row (status=pending or auto_accepted)  │
│    ├─ if Interactive + matches gate path:                │
│    │    wait for decision from app (SQLite poll)         │
│    │    up to timeout                                    │
│    └─ exit 0 (accept) or 1 (block, restore before_blob)  │
│                                                          │
└─────────────────────────────────────────────────────────┘
              │
              │ (SQLite + file watcher)
              ▼
┌─────────────────────────────────────────────────────────┐
│  Tauri app (long-running)                                │
│    ┌────────────────┐         ┌─────────────────────┐    │
│    │ Rust backend   │ ◀────▶  │ React frontend      │    │
│    │  - DB pool     │  IPC    │  - Edit list        │    │
│    │  - Blob store  │         │  - Diff viewer      │    │
│    │  - Rollback    │         │  - Actions          │    │
│    │  - Explain     │         │  - Settings         │    │
│    │  - Event bus   │         │                     │    │
│    └────────────────┘         └─────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Data flow — Observer mode (default)

```
Claude edit → PostToolUse hook → snapshot before+after → edit row (status=pending)
            → event to app → user reviews → Accept (mark accepted) or Reject (restore before)
```

## Data flow — Interactive mode

```
Claude pre-edit → PreToolUse hook → snapshot before → edit row (status=pending)
                → event to app → popup → user decides within timeout
                → Accept: hook exits 0, Claude proceeds → PostToolUse snapshots after
                → Reject: hook exits non-zero, Claude does not edit
                → Timeout: auto-accept, mark auto_accepted
```

## Storage layout

```
~/.claude-manager/
├── db.sqlite
├── db.sqlite-wal
├── db.sqlite-shm
├── blobs/
│   ├── ab/
│   │   └── ab12cd34...ef.bin
│   └── ...
├── logs/
│   └── app.log
├── settings.json          ← mirrors DB settings for hook fast-path
└── backups/
    └── settings.json.20260617T093000Z.bak
```

## UI screens

| Screen | Primitive | Purpose |
|---|---|---|
| Edit List (sidebar + main) | flex row, sidebar virtual list | Browse pending + history |
| Diff Viewer | react-diff-viewer-continued side-by-side | Inspect change |
| Edit Detail | flex column: header, diff, actions, explanation | Decide accept/reject |
| Settings | flex column tabs | Mode, retention, API key, hooks, autostart |
| History | filtered list | Filter status, date, project |
| Sessions | grouped list | Group by Claude session |

## Color / token (UI_RULES compliance)

- Use Tailwind extend with z-index tokens (per UI_RULES §6).
- Spacing scale: 2/4/6/8 token only.
- No bare z-index. Define `z-modal`, `z-popover`, `z-toast` in theme.
- Diff colors: red-50/green-50 backgrounds, red-700/green-700 text.

## Hook script entry (~/.claude/settings.json)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude-manager/bin/claude-manager hook post"
          }
        ]
      }
    ]
  }
}
```

Marker comment in JSON not native, but app stores entries it owns in `~/.claude-manager/owned-hooks.json` for safe uninstall.

## Cross-platform paths

| OS | Settings | Data |
|---|---|---|
| macOS | `~/.claude/settings.json` | `~/.claude-manager/` |
| Linux | `~/.config/claude/settings.json` (verify in scan) | `~/.local/share/claude-manager/` |
| Windows | `%APPDATA%\claude\settings.json` | `%APPDATA%\claude-manager\` |

Phase-1: macOS only. Phase-2 implements scan + import + Linux/Windows.

## Performance budgets

| Op | Target |
|---|---|
| Hook handler exit | <50ms observer mode |
| App startup | <1.5s |
| Diff render (file <500KB) | <100ms |
| Edit list render (500 items) | 60fps scroll |
| Rollback (file <10MB) | <200ms |

## Open questions (deferred to phase-2)

- Autostart mechanism per OS (tauri-plugin-autostart preferred).
- Scan strategy (depth-limited file system walk excluding common heavy dirs).
- Config export format (single JSON bundle vs tar of files).
- Auditor integration: invoke `~/.claude/scripts/run-auditor.sh` and parse output, OR re-implement audit in Rust.
