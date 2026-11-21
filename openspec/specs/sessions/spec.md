# sessions Specification

## Purpose
The Sessions screen lists the Claude Code sessions of each project with their time, size, code change count and rejection count, and lets the user open the session's changes, copy the resume command or move the session to the Trash, without ever showing conversation content. Converted from UC-004 of `docs/specs/`.

## Requirements

### Requirement: UC-004 Sessions are listed by project with time size and counts
The system SHALL list each session under its project with its time, its size, the number of Edit or Write calls Claude made in it and the number of those that were rejected.

#### Scenario: UC-004/AC-1 A session shows its change and rejection counts
- **GIVEN** a session with three Edit or Write calls of Claude, one rejected
- **WHEN** the user opens Sessions
- **THEN** the session shows under its project with its time, its size, 3 changes and 1 rejection

### Requirement: UC-004 Conversation content is never shown
The system SHALL NOT show any text of a prompt, an answer or a tool result, and SHALL read only what UC-001 allows for labelling plus the name, size and date of the session file.

#### Scenario: UC-004/AC-2 No conversation text shows
- **GIVEN** session history holding a prompt, an answer and a tool result
- **WHEN** the user opens Sessions
- **THEN** none of their text shows on screen

### Requirement: UC-004 Opening a session's changes filters the review lists
The system SHALL, when the user presses "Xem thay đổi" on a session, show in Pending and History only the changes labelled with that session, opening Pending when one is still pending and History otherwise.

#### Scenario: UC-004/AC-3 Xem thay đổi filters by session
- **GIVEN** a session with changes
- **WHEN** the user presses "Xem thay đổi"
- **THEN** Pending and History show only the changes labelled with that session

### Requirement: UC-004 The resume command is copied exactly
The system SHALL copy `cd "<project path>" && claude --resume <session id>` for a session of a registered project, and only `claude --resume <session id>` with the note "Không rõ thư mục project — cd vào đúng thư mục trước khi chạy." for a session of an unregistered project, never guessing a folder.

#### Scenario: UC-004/AC-4 A registered project's command holds cd
- **GIVEN** a session of a project registered at `/abs/project`
- **WHEN** the user presses "Chép lệnh resume"
- **THEN** the clipboard holds `cd "/abs/project" && claude --resume <session id>`

#### Scenario: UC-004/AC-4 An unregistered project's command has no cd
- **GIVEN** a session stored under a project folder that is not registered
- **WHEN** the user presses "Chép lệnh resume"
- **THEN** the clipboard holds `claude --resume <session id>` and the note shows beside the button

### Requirement: UC-004 A session moves to the Trash only after confirmation
The system SHALL move a session's history to the macOS Trash, like the cleanup screen, only after the user confirms, also for a session newer than the cleanup age; cancelling SHALL leave it in place.

#### Scenario: UC-004/AC-5 Cancel keeps the session and confirm trashes it
- **GIVEN** any session
- **WHEN** the user presses "Chuyển vào Thùng rác" and cancels, then presses it again and confirms
- **THEN** after the cancel the history is still in place and after the confirmation it is in the macOS Trash

### Requirement: UC-004 Failures are reported and unreadable lines skipped
The system SHALL show "{n} mục không chuyển được" when moving to the Trash fails, keeping the dialog usable, and skip unreadable history lines with "Bỏ qua {n} dòng không đọc được".

#### Scenario: UC-004/E1 A failed move is reported
- **GIVEN** moving a session to the Trash fails
- **WHEN** the user confirms the move
- **THEN** "{n} mục không chuyển được" shows and the dialog stays usable

#### Scenario: UC-004/E2 Unreadable history lines are skipped
- **GIVEN** a session history with two lines that cannot be read
- **WHEN** the user opens Sessions
- **THEN** the session is listed and "Bỏ qua 2 dòng không đọc được" shows
