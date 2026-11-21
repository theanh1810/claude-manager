# storage-cleanup Specification

## Purpose
The cleanup screen shows what in `~/.claude` can be cleaned, in three groups, and moves only the items the user ticked and confirmed to the macOS Trash, so stored clutter goes away without ever losing configuration, kept files or credentials. Converted from UC-005 of `docs/specs/`.

## Requirements

### Requirement: UC-005 The scan uses only name size and date
The system SHALL list each item of `~/.claude` with its name, size and last modification date without opening the content of any file to build the list.

#### Scenario: UC-005/AC-1 Items show name size and date
- **GIVEN** the folder `~/.claude`
- **WHEN** the user opens the cleanup screen
- **THEN** each item shows its name, size and last modification date and no file content was opened

### Requirement: UC-005 Items fall in three groups and the protected group cannot be ticked
The system SHALL put configuration and rule files (`settings.json`, `CLAUDE.md`, `agents/`, `refs/`, `skills/`, `commands/` and the like), every file of the keep list, every file that looks like a credential and every `settings.json.bak*` file in the group "Không đụng tới", which has no checkbox.

#### Scenario: UC-005/AC-2 A settings backup is protected
- **GIVEN** a file matching `~/.claude/settings.json.bak*`
- **WHEN** the user opens the cleanup screen
- **THEN** that file is in "Không đụng tới" and has no checkbox

### Requirement: UC-005 Nothing moves without review tick and confirmation
The system SHALL NOT change anything in `~/.claude` unless the user ticked items and confirmed.

#### Scenario: UC-005/AC-3 Confirming with nothing ticked changes nothing
- **GIVEN** the cleanup screen is open
- **WHEN** the user confirms without ticking any item
- **THEN** nothing in `~/.claude` changes

### Requirement: UC-005 Confirmed items go to the macOS Trash
The system SHALL move each confirmed item to the macOS Trash and never delete it outright.

#### Scenario: UC-005/AC-4 A ticked archive goes to the Trash
- **GIVEN** a file `~/.claude/skills.zip`
- **WHEN** the user ticks `skills.zip` and confirms
- **THEN** `skills.zip` is no longer in `~/.claude` and is in the macOS Trash

### Requirement: UC-005 The age cut-off is chosen each time with 30 days by default
The system SHALL open with an age cut-off of 30 days, list in group (b) only session histories and worktrees unchanged for longer than the cut-off with their total size, and recompute group (b) and the total when the cut-off changes, without ticking or moving any item.

#### Scenario: UC-005/AC-5 Changing the cut-off recomputes without ticking
- **GIVEN** the cleanup screen has just opened
- **WHEN** the user changes the cut-off from 30 to 7 days
- **THEN** group (b) and the total size are recomputed for 7 days and no item is ticked or moved

### Requirement: UC-005 Failures are reported
The system SHALL keep moving the other items when one item cannot be moved and report "{n} mục không chuyển được", and SHALL show "Lỗi quét ~/.claude." with a "Thử lại" button when the scan fails.

#### Scenario: UC-005/E1 One failing item does not stop the others
- **GIVEN** two ticked items, one of which cannot be moved
- **WHEN** the user confirms
- **THEN** the other item is in the Trash and "1 mục không chuyển được" shows

#### Scenario: UC-005/E2 A failed scan offers retry
- **GIVEN** the scan of `~/.claude` fails
- **WHEN** the user opens the cleanup screen
- **THEN** "Lỗi quét ~/.claude." shows with a "Thử lại" button
