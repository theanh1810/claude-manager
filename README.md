# claude-manager

A local desktop companion for [Claude Code](https://claude.com/claude-code). It watches the project folders you register, records the file edits Claude Code makes, and lets you review, accept, reject or roll back each one. Claude Code is never blocked.

The user interface is in Vietnamese.

## Features

- **Edit review**: every recorded file edit can be accepted, rejected, or rolled back to the previous content.
- **Sessions**: browse Claude Code sessions of the registered projects.
- **Memory and errors**: view a project's memory and its error records.
- **OpenSpec**: read the plans and specs of the registered projects.
- **Storage cleanup**: find and remove stored data you no longer need.
- **Explain (optional)**: ask the Anthropic API to explain a selected edit.
- **mem0 (optional)**: connect to mem0 for memory.

## Platforms

Developed and used on macOS (Apple silicon). CI runs front-end lint, type check and tests on Ubuntu, and Rust fmt, clippy and tests on macOS; it builds no bundles. A Windows install guide exists ([`docs/INSTALL.windows.md`](docs/INSTALL.windows.md)), but Windows and Linux are untested. Builds are unsigned.

## Prerequisites

- Node.js 20 or newer
- [pnpm](https://pnpm.io/)
- A Rust toolchain, 1.90 or newer ([rustup](https://rustup.rs/))
- The [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS

## Development

```bash
pnpm install
pnpm tauri dev
```

## Tests

```bash
pnpm exec vitest run
cd src-tauri && cargo test
```

## Build

```bash
pnpm tauri build
```

Bundles are written to `src-tauri/target/release/bundle/`. See [`docs/INSTALL.md`](docs/INSTALL.md) for installing and first launch.

## Security model

- The webview runs under a strict Content-Security-Policy and a minimal Tauri capability set.
- A file restore is refused when the recorded path runs through a symbolic link.
- The network is used only by two optional features: Explain (Anthropic API) and mem0. Explain sends the before and after content of the selected edit to the Anthropic API.
- The API keys for those two features are stored **unencrypted** in the app's local SQLite settings.

## Known limits

- The CSP has not been verified in the real webview on every platform.
- Restore behaviour on Linux and Windows is unverified.
- A restored deleted file is created with mode 0600.

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md)
- [`docs/INSTALL.md`](docs/INSTALL.md)
- [`docs/INSTALL.windows.md`](docs/INSTALL.windows.md)
- [`openspec/specs/`](openspec/specs/)

## Licence

Apache License 2.0, see [`LICENSE`](LICENSE).
