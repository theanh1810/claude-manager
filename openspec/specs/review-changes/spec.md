# review-changes Specification

## Purpose
The review screens record every file change in a watched project, label each change with its source (a Claude Code session and its permission decision, or the user), and let the user accept, reject or roll back changes after they happened, so Claude Code never waits for the app. Converted from UC-001 of `docs/specs/`; its AC-15 (the plan and task label of an edit) is dropped by change `claude-manager-openspec-reader`.

## Requirements

### Requirement: UC-001 Every file change in a watched project is recorded
The system SHALL record each creation, edit or deletion of a file in a watched project as a change shown in Pending with its diff.

#### Scenario: UC-001/AC-1 A file change shows in Pending with its diff
- **GIVEN** a watched project
- **WHEN** a file in the project is changed
- **THEN** the change shows in Pending with its diff

### Requirement: UC-001 Each change carries a source label
The system SHALL label a change made by a Claude Code Edit, Write or NotebookEdit call as "Claude · session <first 8 characters of the session id>" with the decision of that call ("được phép", "bị từ chối", or "không rõ quyết định" when the session records none), label any other change "không rõ / bạn tự sửa", try again to match a "không rõ / bạn tự sửa" change on each later read of session history, and never turn a "Claude" label back.

#### Scenario: UC-001/AC-2 A Claude change is labelled with its session and decision
- **GIVEN** Claude Code runs an Edit on a file of a watched project and the call is allowed
- **WHEN** the app records the change
- **THEN** the change shows "Claude · session <first 8 characters>" with "được phép"

#### Scenario: UC-001/AC-2 A change the user saved is labelled as the user's
- **GIVEN** the user saves a file of a watched project and no Claude call matches it
- **WHEN** the app records the change
- **THEN** the change shows "không rõ / bạn tự sửa", and a later match turns it into a "Claude" label that is never turned back

### Requirement: UC-001 Pending and History show the source and filter Claude changes
The system SHALL show a source column in Pending and in History and offer each tab its own "chỉ thay đổi của Claude" filter, off by default and reset when the app reloads; a session filter set from Sessions SHALL apply to both tabs.

#### Scenario: UC-001/AC-3 The Claude filter of Pending leaves History unfiltered
- **GIVEN** Pending holds changes of Claude and of the user
- **WHEN** the user turns on "chỉ thay đổi của Claude" in Pending
- **THEN** Pending shows only changes labelled "Claude" and History is not filtered

### Requirement: UC-001 Rejecting a pending change restores the file
The system SHALL, when the user rejects a pending change (also one waiting for a decision), return the file to its content before the change, or delete it when the change created it, and move the change to History as rejected without adding a row.

#### Scenario: UC-001/AC-4 Rejecting restores the previous content
- **GIVEN** a change in Pending
- **WHEN** the user rejects it
- **THEN** the file holds its content before the change and the change shows in History as rejected

### Requirement: UC-001 Claude never waits for the app
The system SHALL NOT show a prompt, add a delay or install a blocking hook when Claude Code changes a file.

#### Scenario: UC-001/AC-5 An edit by Claude completes without waiting
- **GIVEN** the app is running
- **WHEN** Claude Code edits a file
- **THEN** the edit completes with no prompt and no delay from the app and no blocking hook is installed

### Requirement: UC-001 Session history is read narrowly and stays on the machine
The system SHALL use, to label a change, only the tool name, file path, time and decision of the matching call, and SHALL NOT send any of them over the network.

#### Scenario: UC-001/AC-6 Labelling reads only four fields and sends nothing
- **GIVEN** Claude Code session history on the machine
- **WHEN** the app labels a change
- **THEN** only the tool name, file path, time and decision of the matching call are used and no network request carries them

### Requirement: UC-001 Bulk buttons are off while a filter is on
The system SHALL disable accept all and reject all while Pending filters on Claude changes or on a session.

#### Scenario: UC-001/AC-7 Bulk buttons are disabled under a filter
- **GIVEN** Pending filters on "chỉ thay đổi của Claude" or on a session
- **WHEN** the user looks at the bulk bar
- **THEN** accept all and reject all are disabled until the filter is removed

### Requirement: UC-001 Settings have no blocking mode and pausing stops recording
The system SHALL offer no run mode (Observer, Interactive, Hybrid), hybrid rules or wait time in Settings, label the pause button "Tạm dừng ghi nhận", and record no new change while paused.

#### Scenario: UC-001/AC-8 Pausing stops recording
- **GIVEN** recording is paused
- **WHEN** a file in a watched project is changed
- **THEN** no new row appears in Pending

### Requirement: UC-001 Accepting a pending change keeps the file
The system SHALL, when the user accepts a pending change, keep the file as it is, write no file, and move the change to History as accepted; accepting a change that is not pending or does not exist SHALL report an error and change nothing.

#### Scenario: UC-001/AC-9 Accepting keeps the file content
- **GIVEN** a change in Pending
- **WHEN** the user accepts it
- **THEN** the file keeps its current content and the change shows in History as accepted

#### Scenario: UC-001/AC-9 Accepting a change that is no longer pending fails
- **GIVEN** a change already accepted
- **WHEN** an accept request for it arrives
- **THEN** an error is reported and nothing changes

### Requirement: UC-001 An accepted change can be rolled back from History
The system SHALL, after the user confirms a rollback of an accepted change, keep a copy of the file's current content, return the file to its content before the change (or delete it when the change created it), add a row "Rollback(<tool>)" in History linked to the original change, and mark the original as rolled back; cancelling SHALL change nothing.

#### Scenario: UC-001/AC-10 Rolling back an accepted change
- **GIVEN** an accepted change in History
- **WHEN** the user rolls it back and confirms
- **THEN** the file holds its content before the change, History shows a "Rollback(<tool>)" row linked to the original, and the original is marked rolled back

### Requirement: UC-001 Accept all and reject all act only on the shown Pending rows
The system SHALL ask for confirmation naming the count and the scope (the selected project or "TẤT CẢ project"), process each shown Pending row so one failure does not stop the others, and report "Đã chấp nhận {n} mục" or "Đã từ chối {n} mục" plus "{m} mục không xử lý được:" and one line "{file}: {lỗi}" per failure.

#### Scenario: UC-001/AC-11 Reject all reports a failing row and processes the rest
- **GIVEN** no filter is on and Pending holds three changes, one of which cannot be restored
- **WHEN** the user presses reject all and confirms
- **THEN** two changes are rejected and the report reads "Đã từ chối 2 mục" with "1 mục không xử lý được:" and one "{file}: {lỗi}" line

#### Scenario: UC-001/AC-11 Reject all leaves an old change for a separate decision
- **GIVEN** Pending holds a change recorded by an old app version whose file differs from its content before the change
- **WHEN** the user presses reject all and confirms
- **THEN** that change stays in Pending and is listed as "{file}: Thay đổi cũ, cần xác nhận riêng — mở mục này để từ chối"

### Requirement: UC-001 A filter that hides the selected change clears the selection
The system SHALL clear the selection when a filter hides the selected change, so the accept and reject shortcuts never act on a change the user cannot see.

#### Scenario: UC-001/AC-12 Filtering out the selected change clears the selection
- **GIVEN** a selected change in Pending
- **WHEN** a filter hides it
- **THEN** no change is selected

### Requirement: UC-001 Keys A and R act on the selected change
The system SHALL accept the selected pending change on A and reject it on R, ignore both keys while the user types in a text field or a dialog is open, and ignore further A and R presses until the decision is done and the next selected change is shown.

#### Scenario: UC-001/AC-13 A quick second press does not act on the next change
- **GIVEN** a pending change is selected
- **WHEN** the user presses A twice quickly
- **THEN** only the selected change is accepted and the next selected change is not acted on by the second press

### Requirement: UC-001 Opening Pending or History reads new session history and shows errors
The system SHALL read new session history when Pending or History opens, at most once every 15 seconds and one run at a time, show "Đang lập chỉ mục lịch sử session — nhãn nguồn có thể chưa đủ" while it runs, and on failure show "Không đọc được lịch sử session: {lỗi} — nhãn nguồn có thể chưa đủ. Mở lại tab để thử lại." and read again on the next opening without waiting.

#### Scenario: UC-001/AC-14 A failed read is shown and retried on the next opening
- **GIVEN** reading session history fails
- **WHEN** the user opens Pending and then opens it again within 15 seconds
- **THEN** the failure message shows and the second opening reads again

### Requirement: UC-001 An old hook call exits at once
The system SHALL, when started as `claude-manager hook ...` by a hook of an old version, read its input, exit with code 0 at once and open no window.

#### Scenario: UC-001/E1 An old hook call returns 0 without a window
- **GIVEN** a machine with a hook of an old version calling `claude-manager hook pre`
- **WHEN** Claude Code runs the hook
- **THEN** the process exits with code 0, opens no window and Claude Code does not wait

### Requirement: UC-001 Uninstall removes only the marked hooks
The system SHALL, on `claude-manager uninstall`, back up `~/.claude/settings.json`, remove the hook entries carrying the marker, keep every other hook, symlink, file permission and key order, and report and change nothing when there is no file or no marked entry.

#### Scenario: UC-001/E2 Uninstall keeps unmarked hooks
- **GIVEN** a `settings.json` with one marked hook and one other hook
- **WHEN** the user runs `claude-manager uninstall`
- **THEN** a backup exists, the marked hook is gone and the other hook stays

### Requirement: UC-001 A file changed again is never overwritten by reject or rollback
The system SHALL NOT overwrite a file that changed again or was deleted after the change being rejected or rolled back; it keeps the change's state and shows "File đã đổi sau thay đổi này", and every other reject or rollback failure is shown with its reason.

#### Scenario: UC-001/E3 A file edited after the change is not restored
- **GIVEN** a pending change whose file was edited again afterwards
- **WHEN** the user rejects it
- **THEN** the file is not written, the change stays pending and "File đã đổi sau thay đổi này" shows

### Requirement: UC-001 An old change without its after-content asks before restoring
The system SHALL, for a change recorded by an old version without its content after the change, compare the file with the content before the change: equal means reject or rollback without writing; different means asking "Thay đổi cũ, không rõ file có bị sửa thêm sau đó không. Vẫn khôi phục về bản trước?" and restoring only on confirmation.

#### Scenario: UC-001/E4 An old change that differs asks first
- **GIVEN** a pending change of an old version whose file differs from its content before the change
- **WHEN** the user rejects it
- **THEN** the question shows and the file is restored only when the user confirms

### Requirement: UC-001 The edit detail names no plan or task
The system SHALL show in the header of an edit's detail the tool and the source label and SHALL NOT show a plan or task label or read any plan file to label an edit.

#### Scenario: UC-001/AC-16 The edit detail shows no plan or task label
- **GIVEN** a Claude edit made while a change whose task lists its file was running
- **WHEN** the user opens the edit's detail
- **THEN** the header shows the tool and the source label and no "Plan {id} · task {id}" or "Thay đổi lẻ {slug}" label

### Requirement: UC-001 A change keeps its label after its session file is trashed
The system SHALL store a change's source label when it is matched, so the label stays after the session history file is moved to the Trash.

#### Scenario: UC-001/ENT A label survives the session file moved to the Trash
- **GIVEN** a change labelled "Claude · session <id>"
- **WHEN** that session's history file is moved to the Trash
- **THEN** the change still shows "Claude · session <id>"

### Requirement: UC-001 The edit detail counts added and removed lines
The system SHALL show in the header of an edit's detail "+{n}" with the number of lines the change added and "-{m}" with the number of lines it removed, counted over the shortest line-by-line difference between the file content before and after the change.

#### Scenario: UC-001/AC-17 Replacing one line counts one added and one removed
- **GIVEN** a change whose file held the lines "a", "b", "c" before and the lines "a", "x", "c" after
- **WHEN** the user opens the change's detail
- **THEN** the header shows "+1" and "-1"

#### Scenario: UC-001/AC-17 Appending two lines counts two added and none removed
- **GIVEN** a change whose file held the line "a" before and the lines "a", "b", "c" after
- **WHEN** the user opens the change's detail
- **THEN** the header shows "+2" and "-0"

### Requirement: UC-001 The review lists move the selection from the keyboard
The system SHALL move the selection of the Pending or History list to the next change on the Down arrow or j and to the previous change on the Up arrow or k and show that change's detail, and SHALL ignore these keys while the user types in a text field, while a dialog is open, and while a decision made with A or R is in flight until the next selected change is shown.

#### Scenario: UC-001/AC-18 j moves the selection to the next change
- **GIVEN** Pending lists two changes and the first one is selected
- **WHEN** the user presses j
- **THEN** the second change is selected and its detail shows

#### Scenario: UC-001/AC-18 Selection keys wait while a key decision is in flight
- **GIVEN** Pending lists three changes, the first one is selected and the user has just pressed A
- **WHEN** the user presses j before the next selected change is shown
- **THEN** the j press changes nothing and, once the first change is accepted, the change the app selects next is the one shown
