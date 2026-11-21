# memory-and-errors Specification

## Purpose
The Memory tab gathers in one place, read only, the memory notes and the recorded errors of every registered project, the global memory under `~/.claude` and the memories kept in mem0, each entry with its source, so the agent's knowledge and past mistakes can be checked. Converted from UC-002 of `docs/specs/`, with the error sources of change `claude-manager-openspec-reader`.

## Requirements

### Requirement: UC-002 Memory and errors come from every agreed source
The system SHALL list memory entries from each registered project's `.claude/MEMORY.md` and `docs/memory/PROJECT-MEM.md`, error entries from its `openspec/changes/<change>/errors.yaml`, `openspec/changes/archive/<folder>/errors.yaml` and `docs/errors/*.yaml`, and, on "Tất cả", memory from `~/.claude/memory/`, `~/.claude/projects/*/memory/` and mem0; error files under `docs/plan/` or `docs/changes/` are not read.

#### Scenario: UC-002/AC-1 Entries come from project files global memory and mem0
- **GIVEN** a registered project with `.claude/MEMORY.md`, `openspec/changes/demo/errors.yaml` and `openspec/changes/archive/2026-01-01-old/errors.yaml`
- **WHEN** the user opens the Memory tab on "Tất cả"
- **THEN** entries from the memory file and from both error files of that project show, together with entries from `~/.claude/memory/`, `~/.claude/projects/*/memory/` and mem0

#### Scenario: UC-002/AC-9 Legacy error files are not listed
- **GIVEN** a registered project whose only error files are `docs/plan/old/errors.yaml` and `docs/changes/old/errors.yaml`
- **WHEN** the user opens the Memory tab
- **THEN** no error entry of that project shows and no problem line names those files

#### Scenario: UC-002/AC-1 Error files without a change folder are still listed
- **GIVEN** a registered project with `docs/errors/s1.yaml`
- **WHEN** the user opens the Memory tab
- **THEN** the entries of `docs/errors/s1.yaml` show

### Requirement: UC-002 An errors file gives one entry per round
The system SHALL turn each round item `- round: <n>` of an errors file into one error entry whose text is that round as written and whose source line is the line of `- round:`; a file without any round item is one entry holding the whole text, and a blank file gives no entry.

#### Scenario: UC-002/AC-8 Two rounds give two entries
- **GIVEN** an `errors.yaml` whose `errors:` list holds round 1 with two entries and round 2 with one entry
- **WHEN** the user opens the Memory tab
- **THEN** exactly two error entries of that file show, each starting at its own `- round:` line

#### Scenario: UC-002/AC-8 A round item inside an entry text does not split the round
- **GIVEN** an `errors.yaml` with one round whose entry `text: |` block holds the line `- round: 9`
- **WHEN** the user opens the Memory tab
- **THEN** exactly one error entry of that file shows

### Requirement: UC-002 Each entry names its source
The system SHALL show with each entry read from a file its path and its start line, and with each mem0 entry its mem0 memory id.

#### Scenario: UC-002/AC-2 A file entry shows its path and line
- **GIVEN** an entry read from `/abs/project/.claude/MEMORY.md` starting at line 3
- **WHEN** the user looks at that entry
- **THEN** it shows `/abs/project/.claude/MEMORY.md:3`, and a mem0 entry shows its mem0 memory id

### Requirement: UC-002 The list is filtered by project and kind and searched by text
The system SHALL let the user filter the list by kind (memory or error) and narrow it by a search text, and SHALL show only the selected project's entries when a project is selected.

#### Scenario: UC-002/AC-3 Filtering by project and kind
- **GIVEN** the list holds memory and error entries of two projects
- **WHEN** the user selects one project and the kind "lỗi" and types a word
- **THEN** only the error entries of that project whose text holds the word remain

### Requirement: UC-002 mem0 is read only and its failures are explained
The system SHALL only read mem0 with the key entered in Cài đặt, never create, change or delete a mem0 memory, and, when mem0 cannot be read, show "mem0 không khả dụng" with the reason of the failure while every file entry still shows.

#### Scenario: UC-002/AC-4 mem0 unavailable keeps the file entries
- **GIVEN** no mem0 key is entered or the network is down
- **WHEN** the user opens the Memory tab
- **THEN** the mem0 part shows "mem0 không khả dụng" with its reason and every entry read from files still shows

#### Scenario: UC-002/E1 No key
- **GIVEN** no mem0 key is entered
- **WHEN** the user opens the Memory tab
- **THEN** the reason reads "Chưa nhập mem0 API key — mở Cài đặt để nhập."

#### Scenario: UC-002/E1 No connection
- **GIVEN** mem0 cannot be reached
- **WHEN** the user opens the Memory tab
- **THEN** the reason reads "Không kết nối được tới mem0. Kiểm tra mạng rồi mở lại màn này."

#### Scenario: UC-002/E1 No answer within 15 seconds
- **GIVEN** mem0 does not answer within 15 seconds
- **WHEN** the user opens the Memory tab
- **THEN** the reason reads "mem0 không trả lời sau 15 giây."

#### Scenario: UC-002/E1 Key refused
- **GIVEN** mem0 answers 401 or 403
- **WHEN** the user opens the Memory tab
- **THEN** the reason reads "mem0 từ chối key (mã {mã lỗi}). Kiểm tra lại key trong Cài đặt."

#### Scenario: UC-002/E1 Other server error
- **GIVEN** mem0 answers another error status
- **WHEN** the user opens the Memory tab
- **THEN** the reason reads "mem0 báo lỗi (mã {mã lỗi})."

#### Scenario: UC-002/E1 Unreadable answer
- **GIVEN** mem0 answers data the app cannot read
- **WHEN** the user opens the Memory tab
- **THEN** the reason reads "mem0 trả về dữ liệu không đọc được."

### Requirement: UC-002 The Memory tab writes nothing and opens files only
The system SHALL NOT change any memory file, errors file or mem0 memory; an entry read from a file offers "Mở file", which opens that file with the default macOS app, and an error entry offers no way to edit or delete it.

#### Scenario: UC-002/AC-5 Opening a file changes nothing
- **GIVEN** an entry read from a project's `.claude/MEMORY.md`
- **WHEN** the user presses "Mở file"
- **THEN** the file opens in the default macOS app and is not changed, and no error entry offers an edit or delete control

### Requirement: UC-002 A selected project hides global memory and mem0
The system SHALL show no mem0 entry and no entry from `~/.claude/memory/` or `~/.claude/projects/*/memory/` while one project is selected.

#### Scenario: UC-002/AC-6 Only the selected project's entries show
- **GIVEN** one project is selected in the project bar
- **WHEN** the user views the Memory tab
- **THEN** no mem0 entry and no global memory entry shows

### Requirement: UC-002 An unreadable file is reported and the rest stay
The system SHALL show, for a memory or errors file that cannot be read, one line "Không đọc được: {lỗi}" with its path, and still list every other entry.

#### Scenario: UC-002/AC-7 An unreadable errors file is a problem line
- **GIVEN** a registered project with a readable `.claude/MEMORY.md` and an unreadable `openspec/changes/demo/errors.yaml`
- **WHEN** the user opens the Memory tab
- **THEN** the entries of `.claude/MEMORY.md` show and a line "Không đọc được: {lỗi}" names the path of that `errors.yaml`
