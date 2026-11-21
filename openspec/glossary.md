# claude-manager

A desktop app that watches the user's projects while Claude Code works in them: it records and reviews file changes, gathers memory and recorded errors, lists sessions, cleans `~/.claude`, and shows the plans agent-hub writes. Terms below are the names specs, tests and UI labels follow.

## Projects and changes to files

**Project**:
A code folder the user registered in the app.
_Avoid_: workspace, repo (when the registered folder is meant)

**Edit**:
One creation, edit or deletion of a file in a watched project, recorded by the app and reviewed on the screens "Chờ duyệt" (Pending) and "Đã xử lý" (History).
_Avoid_: change (reserved for an agent-hub change), diff

**Session**:
One Claude Code run, stored as one history file under `~/.claude/projects/`.

**Tool call**:
One call by Claude of Edit, Write or NotebookEdit inside a session.

**Permission decision**:
Claude Code's allow or reject of a tool call, with who decided it (configuration or the user).

**Source label**:
The label of an edit: "Claude" with its session, or "không rõ / bạn tự sửa".

## Memory and errors

**Memory entry**:
One note read from a project memory file, from the global memory under `~/.claude`, or from mem0. Listed on the "Memory & lỗi" screen (the Memory tab).

**Error entry**:
One round of an errors file, shown on the "Memory & lỗi" screen (the Memory tab).

**mem0**:
The online memory store the agent writes lessons to; the app only reads it.

## Plans

**Change**:
One agent-hub plan folder under `openspec/changes/`, holding `tasks.md`, `plan.vi.md`, its spec deltas and its records.
_Avoid_: plan (for the folder), PR

**Closed change**:
A change whose folder sits under `openspec/changes/archive/<YYYY-MM-DD>-<name>/`; read only.
_Avoid_: done, finished, merged

**Task line**:
A line of `tasks.md` of the form `- [ ] <wave>.<n> <title>` or `- [x] <wave>.<n> <title>`; the only thing counted as a task.

**Wave**:
The group of tasks under one `## Wave <n>` heading of `tasks.md`.

**Approval stamp**:
The 12-hex value on the `stamp:` line of a change's `approval.md`, written when the user approves the plan.

**Approved**:
A change whose approval stamp equals the stamp recomputed from its current tasks and spec deltas.

**Stale approval**:
A change whose approval stamp is present but differs from the recomputed stamp; it needs re-approval.
_Avoid_: expired, invalid approval

**Review round**:
One section `## Round {n} · {kind}` of a change's `review.md`.

**Test round**:
One round of a change's `errors.yaml`, with its verdict and its entries.
_Avoid_: error round, fix round

**Verdict**:
The `red`, `yellow` or `green` of a test round, shown as "Đỏ", "Vàng" or "Xanh".

**Open entry**:
An entry of a test round that carries no `closed_in`.

**Live spec**:
A merged spec `openspec/specs/<capability>/spec.md`.

**Spec debt**:
A business rule applied in code but not yet confirmed and written into a spec, one line in `openspec/_debt.md`.

**Adhoc run**:
A run made without a plan, recorded in `docs/changes/adhoc/<YYYY-MM-DD>-<slug>/` by `record.md` and, when reviewed, `independent.md`.
_Avoid_: one-off change, thay đổi lẻ

## Cleanup

**Cleanup entry**:
One item of `~/.claude` listed by the cleanup screen, in group (a) clearly unneeded, (b) generated and aged, or (c) never touched.
