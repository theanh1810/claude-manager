# plan-tracking Specification

## Purpose
The Plans tab shows, read only and at run time, the plan folders agent-hub writes in each registered project: open and closed changes with their task progress, approval state, review rounds and test rounds, the live specs with the spec debt and the glossary, and the records of runs made without a plan. Approving, editing and commenting stay in Claude Code. Converted from UC-003 of `docs/specs/`, with the behaviour of change `claude-manager-openspec-reader`.

## Requirements

### Requirement: UC-003 The Plans tree lists the plan folders of every registered project
The system SHALL show, for each registered project, a group "Thay đổi" holding the changes under `openspec/changes/` other than `archive/`, a collapsed sub-group "Đã đóng" holding the changes under `openspec/changes/archive/`, and a group "Specs" holding each live spec `openspec/specs/<capability>/spec.md` by capability A to Z, then `openspec/_debt.md` and `openspec/glossary.md` when they exist.

#### Scenario: UC-003/AC-1 Two registered projects each show their own changes and specs
- **GIVEN** two registered projects that each hold one open change, one archived change and one live spec under `openspec/`
- **WHEN** the user opens the Plans tab on "Tất cả" and expands both projects
- **THEN** each project shows its own open change under "Thay đổi", its own archived change under "Đã đóng" and its own live spec under "Specs"

#### Scenario: UC-003/AC-1 Open changes come first by latest write and closed ones by archive date
- **GIVEN** a project with two open changes, the second written to more recently, and two archived changes dated 2026-01-01 and 2026-02-01
- **WHEN** the user expands the project
- **THEN** the more recently written open change is listed first, and under "Đã đóng" the change dated 2026-02-01 is listed before the one dated 2026-01-01

### Requirement: UC-003 A change is closed exactly when its folder is under the archive
The system SHALL treat a change as closed if and only if its folder sits under `openspec/changes/archive/`; a closed change is listed under "Đã đóng" by its name without the date prefix and with its archive date, and its detail is read only, shows the mark "Đã đóng" and the line "Đã đóng ngày {YYYY-MM-DD} · chỉ đọc", and never invites the user to approve.

#### Scenario: UC-003/AC-10 A change under the archive is closed
- **GIVEN** a change folder `openspec/changes/archive/2026-01-02-demo/`
- **WHEN** the user expands its project and opens the change
- **THEN** the change is listed as `demo` with the date 2026-01-02 under "Đã đóng"
- **AND** its detail shows "Đã đóng" and "Đã đóng ngày 2026-01-02 · chỉ đọc" and no "Duyệt trong Claude Code" line

#### Scenario: UC-003/AC-10 A finished change outside the archive stays open
- **GIVEN** a change folder `openspec/changes/demo/` whose every task line is ticked
- **WHEN** the user expands its project
- **THEN** the change is listed under "Thay đổi", not under "Đã đóng", and its detail shows "Duyệt trong Claude Code"

### Requirement: UC-003 Plan files are read from disk when the tab opens or is refreshed
The system SHALL read the plan folders of a project when its node is expanded and again when the user presses the project's refresh button "Đọc lại plan và spec"; the refresh SHALL also read again the change detail and the documents currently open for that project. Nothing is read at build time.

#### Scenario: UC-003/AC-2 A change created after the app was built shows on the next read
- **GIVEN** the Plans tab is open and a new change folder is then written under `openspec/changes/`
- **WHEN** the user presses "Đọc lại plan và spec" of that project
- **THEN** the new change is listed under "Thay đổi"

#### Scenario: UC-003/AC-28 Refresh reads the open detail again
- **GIVEN** a change detail is open and its `tasks.md` gets one more ticked task line on disk
- **WHEN** the user presses "Đọc lại plan và spec" of that project
- **THEN** the detail shows the new progress without the user selecting the change again

### Requirement: UC-003 A project without plan folders shows an explanation
The system SHALL show, for a project that has no `openspec/` folder, the title "Project này chưa có plan agent-hub" and the text "Chưa thấy thư mục openspec/. Thay đổi và spec sẽ hiện ở đây sau khi agent-hub tạo plan đầu tiên trong project." (one line "Chưa có plan agent-hub" on "Tất cả"), without error colour and without a button; legacy plan files (`docs/plan/`, `docs/specs/`, `plan.yaml`, task yaml files, `change-map.json`) are never read.

#### Scenario: UC-003/AC-3 A project without openspec shows the explanation
- **GIVEN** a registered project with no `openspec/` folder
- **WHEN** the user selects the project
- **THEN** the tree shows "Project này chưa có plan agent-hub" and the explanation text and no error

#### Scenario: UC-003/AC-29 A legacy plan.yaml folder is not listed
- **GIVEN** the app's own workspace holds `docs/plan/old/plan.yaml` with its task yaml files
- **WHEN** the user opens the Plans tab
- **THEN** `old` is not listed anywhere in the tab

#### Scenario: UC-003/AC-29 A legacy docs/specs or docs/changes plan is not listed
- **GIVEN** a registered project with no `openspec/` folder but with `docs/specs/use-cases/UC-001-a.md` and `docs/changes/older/plan.yaml`
- **WHEN** the user selects the project
- **THEN** neither the use case nor `older` is listed and the explanation of AC-3 shows

### Requirement: UC-003 The approval state comes from the stamp in approval.md
The system SHALL show a change as "Plan đã duyệt" if and only if its `approval.md` holds a line `stamp: <12 lowercase hex>` equal to the stamp the system recomputes from the folder as agent-hub does (sha256 over the sorted task id and `Files:` pairs of `tasks.md` and the bytes of `specs/**`, first 12 hex), as "Cần duyệt lại" if and only if such a line is present and differs, and as "Plan chưa duyệt" otherwise.

#### Scenario: UC-003/AC-15 A stamp equal to the recomputed stamp reads as approved
- **GIVEN** a change whose `approval.md` holds the stamp agent-hub computed for its current `tasks.md` and `specs/`
- **WHEN** the user opens the change
- **THEN** the tree row and the detail show "Plan đã duyệt" and the detail explains "Dấu duyệt khớp với plan hiện tại."

#### Scenario: UC-003/AC-15 Ticking task boxes keeps the approval
- **GIVEN** an approved change in which a task box is then ticked without changing any task id or `Files:` line
- **WHEN** the user refreshes the project
- **THEN** the change still shows "Plan đã duyệt"

#### Scenario: UC-003/AC-16 A stamp that no longer matches reads as needing re-approval
- **GIVEN** an approved change whose `tasks.md` then gains a task or whose `Files:` line or spec delta then changes
- **WHEN** the user opens the change
- **THEN** it shows "Cần duyệt lại" in the rose tone with the warning "Plan đã đổi sau lần duyệt trước. Duyệt lại trong Claude Code." and never "Plan đã duyệt"

#### Scenario: UC-003/AC-17 A change without a stamp line reads as not approved
- **GIVEN** a change with no `approval.md`, or with an `approval.md` whose stamp line holds 11 hex digits or upper-case hex
- **WHEN** the user opens the change
- **THEN** it shows "Plan chưa duyệt" with "Chưa có dấu duyệt trong approval.md. Duyệt trong Claude Code." and neither "Plan đã duyệt" nor "Cần duyệt lại"

### Requirement: UC-003 Task progress counts only agent-hub task lines
The system SHALL count as a task only a line of `tasks.md` of the form `- [ ] <n>.<m> <title>` or `- [x] <n>.<m> <title>` (`X` also ticks), show "{done}/{total} task" on the tree row and "{done}/{total} task xong" with a progress bar in the detail, and group the tasks by the `## Wave <n>` heading they sit under, tasks under no such heading in a last group "Chưa nhóm wave".

#### Scenario: UC-003/AC-18 Ticked and unticked task lines are counted
- **GIVEN** a `tasks.md` with three task lines `- [x] 1.1 A`, `- [X] 1.2 B` and `- [ ] 2.1 C`
- **WHEN** the user opens the change
- **THEN** the row shows "2/3 task" and the detail shows "2/3 task xong"

#### Scenario: UC-003/AC-18 Lines that are not task lines are not counted
- **GIVEN** a `tasks.md` with one task line `- [ ] 1.1 A` plus the lines `- [ ] 3 no dotted id`, `- [x] note`, `  Files: a.rs` and `* [ ] 1.2 star bullet`
- **WHEN** the user opens the change
- **THEN** the row shows "0/1 task"

#### Scenario: UC-003/AC-19 Tasks are grouped by wave and a task outside a wave is ungrouped
- **GIVEN** a `tasks.md` with `## Wave 1` holding tasks 1.1 and 1.2 both ticked, `## Wave 2` holding task 2.1 unticked, and a task line 3.1 above the first wave heading
- **WHEN** the user opens the change
- **THEN** the detail shows "Wave 1" with "2/2" collapsed, "Wave 2" with "0/1" expanded, and a last group "Chưa nhóm wave" holding 3.1

#### Scenario: UC-003/AC-18 A change without tasks.md shows no task count
- **GIVEN** a change folder with no `tasks.md`
- **WHEN** the user opens the change
- **THEN** the row shows "chưa có task" and the detail shows "Chưa có tasks.md"

### Requirement: UC-003 Review rounds are shown from review.md
The system SHALL split `review.md` at each heading `## Round {n} · {kind}` and show one collapsed row "Vòng {n} · {kind}" per section, newest round first, whose body is the section rendered as Markdown; a change without `review.md` shows "Chưa có vòng review nào". The system SHALL NOT interpret the verdict text inside a section.

#### Scenario: UC-003/AC-20 Review sections show newest first
- **GIVEN** a `review.md` with the sections `## Round 1 · independent` and `## Round 2 · task 2.1`
- **WHEN** the user opens the change
- **THEN** the Review section lists "Vòng 2 · task 2.1" then "Vòng 1 · independent", both collapsed, and opening one shows only that section's text

### Requirement: UC-003 Test rounds are summarised from errors.yaml
The system SHALL show, per round of `errors.yaml`, "Vòng {n}", the round's `verdict` as "Đỏ", "Vàng" or "Xanh" with its icon, and "Mở: {c} nghiêm trọng · {m} lớn · {n} nhỏ" counting by `severity` the entries of that round that carry no `closed_in`, or "Không còn lỗi mở" when all three are zero, newest round first; the latest round's verdict also marks the tree row.

#### Scenario: UC-003/AC-21 An entry without closed_in is counted as open
- **GIVEN** an `errors.yaml` whose round 2 has verdict `red` and the entries critical without `closed_in`, minor without `closed_in` and minor without `closed_in`
- **WHEN** the user opens the change
- **THEN** the Test section shows "Vòng 2", "Đỏ" and "Mở: 1 nghiêm trọng · 0 lớn · 2 nhỏ", and the tree row carries the red verdict icon named "Test gần nhất: đỏ"

#### Scenario: UC-003/AC-21 An entry with closed_in is not counted as open
- **GIVEN** an `errors.yaml` whose round 1 has verdict `yellow` and one major entry with `closed_in: 2` and no other entry
- **WHEN** the user opens the change
- **THEN** the row of "Vòng 1" shows "Vàng" and "Không còn lỗi mở"

#### Scenario: UC-003/AC-21 A change without errors.yaml has no test round
- **GIVEN** a change folder with no `errors.yaml`
- **WHEN** the user opens the change
- **THEN** the Test section shows "Chưa có vòng test nào" and the tree row has no verdict icon

### Requirement: UC-003 A plan file of unexpected shape is shown as written
The system SHALL show, in place of a summary, the notice "Không đọc được tóm tắt {file name}. Hiện nguyên file bên dưới." and the file text as written when a non-blank `tasks.md` holds no task line, a non-blank `review.md` holds no round heading, or `errors.yaml` is not a list of rounds each with an integer `round`, a verdict `red`, `yellow` or `green` and entry severities `critical`, `major` or `minor`; other sections still show.

#### Scenario: UC-003/AC-22 A well-formed errors.yaml is summarised
- **GIVEN** an `errors.yaml` with `errors:` holding one round `round: 1`, `verdict: green` and `entries: []`
- **WHEN** the user opens the change
- **THEN** the Test section shows "Vòng 1", "Xanh" and "Không còn lỗi mở" and no fallback notice

#### Scenario: UC-003/AC-22 A malformed errors.yaml is shown as written
- **GIVEN** an `errors.yaml` whose only round has `verdict: blue`
- **WHEN** the user opens the change
- **THEN** the Test section shows "Không đọc được tóm tắt errors.yaml. Hiện nguyên file bên dưới." and the file text, and the Review and Tiến độ sections still show

#### Scenario: UC-003/AC-23 A tasks.md or review.md without the expected lines is shown as written
- **GIVEN** a `tasks.md` holding only prose and a `review.md` holding only `# Notes`
- **WHEN** the user opens the change
- **THEN** the Tiến độ section shows the notice for `tasks.md` and its text, and the Review section shows the notice for `review.md` and its text

### Requirement: UC-003 A change detail lists its documents with plan.vi.md first
The system SHALL show in the change detail, in this order, the sections "Duyệt plan", "Tiến độ", "Review", "Test" and "Tài liệu"; "Tài liệu" lists the existing files among `plan.vi.md` (open by default), `proposal.md`, `design.md` and each `specs/<capability>/spec.md` A to Z, each rendered as Markdown, or "Thay đổi này chưa có tài liệu nào" when none exists.

#### Scenario: UC-003/AC-9 Opening a change shows plan.vi.md first and open
- **GIVEN** a change holding `plan.vi.md`, `proposal.md`, `design.md` and `specs/b/spec.md` and `specs/a/spec.md`
- **WHEN** the user opens the change
- **THEN** "Tài liệu" lists `plan.vi.md` open and rendered, then `proposal.md`, `design.md`, `specs/a/spec.md` and `specs/b/spec.md` collapsed

### Requirement: UC-003 The Plans tab never writes and offers no edit control
The system SHALL NOT offer any button or text field to approve, stamp, edit, add to or comment on a change, a task or a spec, and SHALL NOT write any file in a registered project from the Plans tab; approving and editing happen in Claude Code.

#### Scenario: UC-003/AC-6 No control approves or stamps a plan
- **GIVEN** a change shown as "Plan chưa duyệt"
- **WHEN** the user looks at its row and its detail
- **THEN** no button or field approves or stamps it and the detail points to "Duyệt trong Claude Code"

#### Scenario: UC-003/AC-8 No control edits a spec or adds a comment
- **GIVEN** a change detail and a live spec are shown
- **WHEN** the user looks for a way to edit, add to or comment on them
- **THEN** the screen has no text field and no comment, edit or add button, and no `comments.jsonl` is written

### Requirement: UC-003 Reading a plan file stays inside the plan folders of the project
The system SHALL read a file for the Plans tab only when its path, relative to a registered project, is not empty, is not absolute, holds no `..` segment, and resolves (after following links) to a file inside the project's `openspec/` or `docs/changes/adhoc/` folder; any other path SHALL be refused with an error and nothing is read.

#### Scenario: UC-003/AC-25 A file inside the plan folders is read
- **GIVEN** a registered project with `openspec/changes/demo/plan.vi.md`
- **WHEN** the app asks for `openspec/changes/demo/plan.vi.md` of that project
- **THEN** the file text is returned

#### Scenario: UC-003/AC-25 A path leaving the plan folders is refused
- **GIVEN** a registered project and a file `secret.txt` beside its `openspec/` folder
- **WHEN** the app asks for `openspec/../secret.txt`, for an absolute path, for `docs/specs/README.md`, or for a link inside `openspec/` pointing to `secret.txt`
- **THEN** each request is refused with an error and no file text is returned

#### Scenario: UC-003/AC-25 An unregistered project is refused
- **GIVEN** a folder that is not a registered project
- **WHEN** the app asks for the plan tree or a plan file of that folder
- **THEN** the request is refused with "unknown project"

### Requirement: UC-003 Runs without a plan are listed as read-only records
The system SHALL list each folder `docs/changes/adhoc/<YYYY-MM-DD>-<slug>/` of a project in a collapsed group "Việc nhỏ (adhoc)", newest date first then slug A to Z, by slug and date, also when the project has no `openspec/` folder; opening one shows "{YYYY-MM-DD} · việc nhỏ chạy không qua plan · chỉ đọc", its `record.md` open by default and its `independent.md` when it exists, or "Chưa có record.md".

#### Scenario: UC-003/AC-26 Adhoc runs are listed newest first and open read only
- **GIVEN** a project with `docs/changes/adhoc/2026-03-01-fix-a/record.md` and `docs/changes/adhoc/2026-03-05-fix-b/` holding `record.md` and `independent.md`
- **WHEN** the user expands "Việc nhỏ (adhoc)" and opens `fix-b`
- **THEN** `fix-b` is listed before `fix-a`, and the detail shows `record.md` open and `independent.md` collapsed, with no edit control

#### Scenario: UC-003/AC-27 Adhoc runs show in a project without openspec
- **GIVEN** a project with no `openspec/` folder and one folder under `docs/changes/adhoc/`
- **WHEN** the user selects the project
- **THEN** the explanation of AC-3 shows and the group "Việc nhỏ (adhoc)" lists that run

### Requirement: UC-003 A file that cannot be read is reported where it is shown
The system SHALL show "Không đọc được: {error}" in place of a file or a tree group that cannot be read, with a "Thử lại" button for a group or a change detail, and keep every other file and section shown.

#### Scenario: UC-003/E1 An unreadable document leaves the rest of the detail shown
- **GIVEN** a change whose `design.md` cannot be read
- **WHEN** the user opens `design.md` in "Tài liệu"
- **THEN** that document shows "Không đọc được: {error}" and the other sections and documents still show
