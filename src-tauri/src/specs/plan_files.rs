//! The plan files of one OpenSpec change folder, read only: task lines grouped by wave, the approval
//! stamp, and the sections of review.md. Line scans that mirror agent-hub's `plan-check.py`
//! (`TASK_LINE`, `KEY_LINE`, `STAMP_LINE`, `compute_stamp`); nothing here writes.

use crate::specs::reader;
use crate::store::mask_err;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::cmp::{Ordering, Reverse};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// A plan file as the detail shows it: absent, summarised, in a shape the scan does not know (the
/// renderer then shows `raw`, the file text, as written), or not readable at all (`message` says why).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Section<T> {
    Missing,
    Ok(T),
    Unreadable { raw: String },
    Error { message: String },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Approval {
    Approved,
    NotApproved,
    Stale,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TaskItem {
    pub id: String,
    pub title: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WaveGroup {
    /// The `n` of `## Wave <n>`; None for task lines under no such heading.
    pub wave: Option<u32>,
    pub done: u32,
    pub total: u32,
    pub tasks: Vec<TaskItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TasksOk {
    pub done: u32,
    pub total: u32,
    pub waves: Vec<WaveGroup>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReviewRound {
    pub n: u32,
    pub kind: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReviewOk {
    pub rounds: Vec<ReviewRound>,
}

fn read_io(path: &Path) -> std::io::Result<String> {
    if std::fs::metadata(path)?.len() > MAX_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file larger than 2 MiB",
        ));
    }
    std::fs::read_to_string(path)
}

pub(crate) fn read_text(path: &Path) -> Result<String, String> {
    read_io(path).map_err(mask_err)
}

/// `path` summarised by `parse`: a file that does not exist is `Missing`, one that cannot be read
/// (a folder, no permission, over 2 MiB) is an `Error` carrying the reason.
#[cfg(test)]
pub(crate) fn section_of<T>(path: &Path, parse: fn(&str) -> Section<T>) -> Section<T> {
    section_from(read_io(path), parse)
}

/// The text of a file already opened, with the same 2 MiB cap as `read_text`.
pub(crate) fn read_opened(f: &std::fs::File) -> std::io::Result<String> {
    reader::read_handle_text(f, MAX_BYTES)
}

/// `section_of` for a read made by the caller.
pub(crate) fn section_from<T>(
    text: std::io::Result<String>,
    parse: fn(&str) -> Section<T>,
) -> Section<T> {
    match text {
        Ok(text) => parse(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Section::Missing,
        Err(e) => Section::Error {
            message: mask_err(e),
        },
    }
}

struct TaskLine {
    id: String,
    title: String,
    done: bool,
    wave: Option<u32>,
}

/// The keys plan-check reads from the lines under a task, in the order of `Block::keys`.
const KEYS: [&str; 4] = ["Files", "Covers", "Done when", "Test"];
const FILES_KEY: usize = 0;

/// One task id with the value of each of `KEYS` in its first block (empty when the key is absent or empty).
struct Block {
    id: String,
    keys: [String; 4],
}

struct Scan {
    lines: Vec<TaskLine>,
    /// One block per task id, in file order.
    blocks: Vec<Block>,
    /// False when plan-check would reject the structure (a repeated id, a task outside a `## Wave <n>` section)
    /// or a line is one Rust and Python could classify differently: no stamp is computed then.
    sound: bool,
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Python's `str.isspace`, which `\s` and `str.strip` follow: the Unicode white space plus U+001C to U+001F.
fn py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// `text.splitlines()` after the universal-newline read of plan-check: `\r\n` is one break, and each of
/// `\n \r \x0b \x0c \x1c \x1d \x1e \x85 \u2028 \u2029` is a break. No empty last line.
fn py_lines(text: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((at, c)) = chars.next() {
        if !matches!(
            c,
            '\n' | '\r'
                | '\x0b'
                | '\x0c'
                | '\x1c'
                | '\x1d'
                | '\x1e'
                | '\u{85}'
                | '\u{2028}'
                | '\u{2029}'
        ) {
            continue;
        }
        lines.push(&text[start..at]);
        start = at + c.len_utf8();
        if c == '\r' && chars.next_if(|&(_, next)| next == '\n').is_some() {
            start += 1;
        }
    }
    if start < text.len() {
        lines.push(&text[start..]);
    }
    lines
}

/// What follows `Wave` in `^#{1,6}\s*Wave`, case-insensitive; None for any other line.
fn after_wave_word(line: &str) -> Option<&str> {
    let hashes = line.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let rest = line[hashes..].trim_start_matches(py_space);
    let head = rest.get(..4)?;
    head.eq_ignore_ascii_case("wave").then(|| &rest[4..])
}

/// `^#{1,6}\s*Wave\b`, case-insensitive: any heading that names a wave.
fn names_a_wave(line: &str) -> bool {
    after_wave_word(line).is_some_and(|tail| !tail.starts_with(is_word))
}

/// `^## \S`: a level-2 heading.
fn is_h2(line: &str) -> bool {
    line.strip_prefix("## ")
        .and_then(|r| r.chars().next())
        .is_some_and(|c| !py_space(c))
}

/// The `n` of `^## Wave (\d+)\b`; None for any other line.
fn wave_number(line: &str) -> Option<u32> {
    let rest = line.strip_prefix("## Wave ")?;
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 || rest[digits..].starts_with(is_word) {
        return None;
    }
    rest[..digits].parse().ok()
}

/// `^- \[[ xX]\] (\d+\.\d+) (.+?)\s*$`: (id, title, done).
fn task_line(line: &str) -> Option<(&str, &str, bool)> {
    let rest = line.strip_prefix("- [")?;
    let done = match rest.chars().next()? {
        ' ' => false,
        'x' | 'X' => true,
        _ => return None,
    };
    let rest = rest[1..].strip_prefix("] ")?;
    let major = rest.chars().take_while(char::is_ascii_digit).count();
    let after = rest[major..].strip_prefix('.')?;
    let minor = after.chars().take_while(char::is_ascii_digit).count();
    if major == 0 || minor == 0 {
        return None;
    }
    let title = after[minor..].strip_prefix(' ')?;
    (!title.is_empty()).then(|| {
        (
            &rest[..major + 1 + minor],
            title.trim_matches(py_space),
            done,
        )
    })
}

/// `^\s+(Files|Covers|Done when|Test):[ \t]*(.*?)\s*$`: the index in `KEYS` and the value of a key line.
fn key_line(line: &str) -> Option<(usize, &str)> {
    let rest = line.trim_start_matches(py_space);
    if rest.len() == line.len() {
        return None;
    }
    let (key, value) = KEYS
        .iter()
        .enumerate()
        .find_map(|(i, k)| Some((i, rest.strip_prefix(k)?.strip_prefix(':')?)))?;
    Some((
        key,
        value
            .trim_start_matches([' ', '\t'])
            .trim_end_matches(py_space),
    ))
}

/// A line whose class Rust and Python could decide differently: a non-ASCII digit in a task id or a wave number,
/// or a non-ASCII letter or digit right after `Wave` or its number. Python's `\d` and `\b` read all of Unicode;
/// the scans above read ASCII digits, so compute_stamp gives no stamp for a file holding such a line.
fn classified_differently(line: &str) -> bool {
    let non_ascii_digit = |c: char| !c.is_ascii() && c.is_numeric();
    let non_ascii_word = |c: char| !c.is_ascii() && c.is_alphanumeric();
    if let Some(id) = ["- [ ] ", "- [x] ", "- [X] "]
        .iter()
        .find_map(|p| line.strip_prefix(p))
    {
        return id
            .split(' ')
            .next()
            .unwrap_or("")
            .chars()
            .any(non_ascii_digit);
    }
    if after_wave_word(line)
        .and_then(|tail| tail.chars().next())
        .is_some_and(non_ascii_word)
    {
        return true;
    }
    let Some(number) = line.strip_prefix("## Wave ") else {
        return false;
    };
    let end = number
        .find(|c: char| !(c.is_ascii_digit() || non_ascii_digit(c)))
        .unwrap_or(number.len());
    let (digits, after) = number.split_at(end);
    digits.chars().any(non_ascii_digit)
        || (!digits.is_empty() && after.chars().next().is_some_and(non_ascii_word))
}

/// agent-hub's `scan_tasks`: a heading ends the wave, a key line attaches to the current task even across
/// headings (a later one of the same key replaces the earlier), one before any task is ignored, and a repeated
/// task id keeps its first block.
fn scan(text: &str) -> Scan {
    let mut out = Scan {
        lines: Vec::new(),
        blocks: Vec::new(),
        sound: true,
    };
    let mut seen: HashSet<&str> = HashSet::new();
    let mut wave = None;
    let mut current: Option<usize> = None;
    for line in py_lines(text) {
        out.sound &= !classified_differently(line);
        if names_a_wave(line) || is_h2(line) {
            wave = wave_number(line);
            continue;
        }
        if let Some((id, title, done)) = task_line(line) {
            out.sound &= wave.is_some();
            out.lines.push(TaskLine {
                id: id.to_string(),
                title: title.to_string(),
                done,
                wave,
            });
            current = if !seen.insert(id) {
                out.sound = false;
                None
            } else {
                out.blocks.push(Block {
                    id: id.to_string(),
                    keys: Default::default(),
                });
                Some(out.blocks.len() - 1)
            };
        } else if let (Some((key, value)), Some(i)) = (key_line(line), current) {
            out.blocks[i].keys[key] = value.to_string();
        }
    }
    out
}

fn is_blank(text: &str) -> bool {
    text.trim().is_empty()
}

fn wave_group(wave: Option<u32>, lines: &[&TaskLine]) -> WaveGroup {
    let tasks: Vec<TaskItem> = lines
        .iter()
        .map(|t| TaskItem {
            id: t.id.clone(),
            title: t.title.clone(),
            done: t.done,
        })
        .collect();
    let done = tasks.iter().filter(|t| t.done).count() as u32;
    WaveGroup {
        wave,
        done,
        total: tasks.len() as u32,
        tasks,
    }
}

/// Task progress of `tasks.md`: the task lines grouped by wave ascending, tasks under no wave last. A file
/// that is not blank and holds no task line is shown as written.
pub fn tasks_section(text: &str) -> Section<TasksOk> {
    let lines = scan(text).lines;
    if lines.is_empty() {
        return if is_blank(text) {
            Section::Ok(TasksOk {
                done: 0,
                total: 0,
                waves: Vec::new(),
            })
        } else {
            Section::Unreadable {
                raw: text.to_string(),
            }
        };
    }
    let mut by_wave: BTreeMap<(u8, u32), Vec<&TaskLine>> = BTreeMap::new();
    for line in &lines {
        by_wave
            .entry(line.wave.map_or((1, 0), |n| (0, n)))
            .or_default()
            .push(line);
    }
    let waves: Vec<WaveGroup> = by_wave
        .into_iter()
        .map(|((last, n), group)| wave_group((last == 0).then_some(n), &group))
        .collect();
    Section::Ok(TasksOk {
        done: waves.iter().map(|w| w.done).sum(),
        total: waves.iter().map(|w| w.total).sum(),
        waves,
    })
}

/// `^## Round (\d+) · (.+)`: (n, kind), with U+00B7 between spaces.
fn round_heading(line: &str) -> Option<(u32, &str)> {
    let rest = line.strip_prefix("## Round ")?;
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    let kind = rest[digits..].strip_prefix(" \u{b7} ")?.trim();
    if kind.is_empty() {
        return None;
    }
    Some((rest[..digits].parse().ok()?, kind))
}

/// Rounds of `review.md`, newest first. The text under a heading up to the next round heading is the
/// round's markdown; text before the first heading is dropped and the verdict wording is never read.
pub fn review_section(text: &str) -> Section<ReviewOk> {
    let mut rounds: Vec<(u32, &str, Vec<&str>)> = Vec::new();
    for line in text.lines() {
        match (round_heading(line), rounds.last_mut()) {
            (Some((n, kind)), _) => rounds.push((n, kind, Vec::new())),
            (None, Some((_, _, body))) => body.push(line),
            (None, None) => {}
        }
    }
    if rounds.is_empty() {
        return if is_blank(text) {
            Section::Ok(ReviewOk { rounds: Vec::new() })
        } else {
            Section::Unreadable {
                raw: text.to_string(),
            }
        };
    }
    let mut rounds: Vec<ReviewRound> = rounds
        .into_iter()
        .rev()
        .map(|(n, kind, body)| ReviewRound {
            n,
            kind: kind.to_string(),
            markdown: trim_blank_lines(&body),
        })
        .collect();
    rounds.sort_by_key(|r| Reverse(r.n));
    Section::Ok(ReviewOk { rounds })
}

fn trim_blank_lines(lines: &[&str]) -> String {
    let first = lines
        .iter()
        .position(|l| !is_blank(l))
        .unwrap_or(lines.len());
    let last = lines
        .iter()
        .rposition(|l| !is_blank(l))
        .map_or(first, |i| i + 1);
    lines[first..last].join("\n")
}

/// Numeric order of two digit strings of any length (leading zeros ignored).
fn number_order(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.trim_start_matches('0'), b.trim_start_matches('0'));
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

fn id_order(a: &str, b: &str) -> Ordering {
    let (a, b) = (
        a.split_once('.').unwrap_or((a, "")),
        b.split_once('.').unwrap_or((b, "")),
    );
    number_order(a.0, b.0).then_with(|| number_order(a.1, b.1))
}

/// A spec walk past this many entries gives no stamp, as one whose files total more than `MAX_SPEC_BYTES`.
const MAX_SPEC_ENTRIES: usize = 1_000;
const MAX_SPEC_BYTES: u64 = 8 * 1024 * 1024;

/// `path` with every link followed, when it lies inside `base`.
fn real_inside(path: &Path, base: &Path) -> Option<PathBuf> {
    path.canonicalize()
        .ok()
        .filter(|real| real.starts_with(base))
}

/// The files under `change_dir/specs` as paths relative to `change_dir`, sorted; None past the walk budget or
/// when the folder, or one of its files, is a link to a place outside `base`.
fn spec_files(change_dir: &Path, base: &Path) -> Option<Vec<PathBuf>> {
    let specs = change_dir.join("specs");
    let mut files: Vec<PathBuf> = Vec::new();
    if specs.is_dir() {
        real_inside(&specs, base)?;
        for (seen, entry) in WalkDir::new(&specs).min_depth(1).into_iter().enumerate() {
            if seen >= MAX_SPEC_ENTRIES {
                return None;
            }
            let path = entry.ok()?.into_path();
            if path.is_file() {
                real_inside(&path, base)?;
                files.push(path.strip_prefix(change_dir).ok()?.to_path_buf());
            }
        }
    }
    files.sort();
    Some(files)
}

/// agent-hub's `compute_stamp`: the first 12 hex of the sha256 over the task ids with their sorted `Files:`
/// (ids by their numbers, equal numbers in file order), then each file under `specs/` by sorted path
/// components with its bytes. None when `tasks.md` or a spec file cannot be read or is over 2 MiB, when
/// either, or `specs/`, is a link to a place outside `base` (the canonical `openspec/` of the project: a link
/// that stays inside it is followed, as agent-hub does), when the specs walk is over its budget, when plan-check's
/// check 1 would not pass (no task, a repeated id, a task outside a wave, a task lacking a key) or a line is
/// one Rust and Python could classify differently, so such a change can never read as approved.
pub fn compute_stamp(change_dir: &Path, base: &Path) -> Option<String> {
    let tasks = reader::open_inside(&change_dir.join("tasks.md"), base).ok()??;
    let scan = scan(&read_opened(&tasks).ok()?);
    if !scan.sound
        || scan.blocks.is_empty()
        || scan
            .blocks
            .iter()
            .any(|b| b.keys.iter().any(String::is_empty))
    {
        return None;
    }
    let mut tasks: Vec<&Block> = scan.blocks.iter().collect();
    tasks.sort_by(|a, b| id_order(&a.id, &b.id));
    let mut hash = Sha256::new();
    for task in tasks {
        let mut names: Vec<&str> = task.keys[FILES_KEY]
            .split(',')
            .map(|f| f.trim_matches(py_space))
            .filter(|f| !f.is_empty())
            .collect();
        names.sort_unstable();
        hash.update(format!("{}\0{}\n", task.id, names.join("\0")));
    }
    let mut spec_bytes = 0;
    for rel in spec_files(change_dir, base)? {
        let posix: Vec<String> = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        hash.update(posix.join("/"));
        hash.update([0]);
        let full = change_dir.join(&rel);
        let file = reader::open_inside(&full, base).ok()??;
        let len = file.metadata().ok()?.len();
        spec_bytes += len;
        if len > MAX_BYTES || spec_bytes > MAX_SPEC_BYTES {
            return None;
        }
        hash.update(reader::read_capped(&file, MAX_BYTES).ok()?);
        hash.update([0]);
    }
    Some(hex::encode(hash.finalize())[..12].to_string())
}

/// `^stamp:\s*([0-9a-f]{12})\s*$` under `re.M` on universal-newline text, first match wins. `\s` crosses a
/// newline, so the 12 digits may sit on a later line; the run of space after them must hold a newline or end the text.
fn stamp_line(text: &str) -> Option<String> {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let line_starts = std::iter::once(0).chain(text.match_indices('\n').map(|(at, _)| at + 1));
    line_starts.into_iter().find_map(|at| {
        let rest = text[at..]
            .strip_prefix("stamp:")?
            .trim_start_matches(py_space);
        let digits = rest
            .get(..12)
            .filter(|d| d.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))?;
        let after = &rest[12..];
        let space = &after[..after.find(|c| !py_space(c)).unwrap_or(after.len())];
        (space.contains('\n') || space.len() == after.len()).then(|| digits.to_string())
    })
}

/// Approved when `approval.md` holds a stamp equal to the one recomputed from the folder, stale when it
/// holds one that differs (or that cannot be recomputed), not approved without one, or when `approval.md` is a
/// link to a place outside `base` (see `compute_stamp`).
pub fn approval_state(change_dir: &Path, base: &Path) -> Approval {
    let Ok(Some(approval)) = reader::open_inside(&change_dir.join("approval.md"), base) else {
        return Approval::NotApproved;
    };
    let Ok(text) = read_opened(&approval) else {
        return Approval::NotApproved;
    };
    let Some(stamp) = stamp_line(&text) else {
        return Approval::NotApproved;
    };
    if compute_stamp(change_dir, base).as_deref() == Some(stamp.as_str()) {
        Approval::Approved
    } else {
        Approval::Stale
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const GOLDEN_TASKS: &str = "# Tasks: demo\n\n## Wave 1\n\n- [x] 1.10 Later task\n  Files: src/b.rs, src/a.rs\n  Covers: none\n  Done when: it works\n  Test: unit\n- [ ] 1.2 Earlier task\n  Files:   src/c.ts  \n  Covers: none\n  Done when: it works\n  Test: unit\n\n## Wave 2\n\n- [ ] 2.1 Tiếng Việt có dấu\n  Files: docs/ghi-chú.md\n  Covers: none\n  Done when: it works\n  Test: script\n";
    const GOLDEN_SPEC_A: &str =
        "## ADDED Requirements\n\n### Requirement: A\nThe system SHALL do a.\n";
    const GOLDEN_SPEC_AB: &str =
        "## ADDED Requirements\n\n### Requirement: A-B\nThe system SHALL do đ.\n";
    /// agent-hub 0.2.5 `compute_stamp` over the fixture of design.md D4.
    const GOLDEN_STAMP: &str = "64519d38be24";
    const STAMPED_WITH_GOLDEN: &str =
        "# Approval\n\nstamp: 64519d38be24\n\n## User's words\n\nok\n";

    fn put(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    /// The change folder of design.md D4 with the given approval.md.
    fn golden(approval: &str) -> TempDir {
        let d = TempDir::new().unwrap();
        golden_at(d.path(), approval);
        d
    }

    fn golden_at(change: &Path, approval: &str) {
        put(change, "tasks.md", GOLDEN_TASKS);
        put(change, "specs/a/spec.md", GOLDEN_SPEC_A);
        put(change, "specs/a-b/spec.md", GOLDEN_SPEC_AB);
        put(change, "approval.md", approval);
    }

    /// A change folder read with itself as the plan base: nothing may leave the folder.
    fn stamp_of(change: &Path) -> Option<String> {
        stamp_in(change, &change.canonicalize().unwrap())
    }

    fn state_of(change: &Path) -> Approval {
        state_in(change, &change.canonicalize().unwrap())
    }

    // The two readers over a change folder inside the plan base `base`.
    fn stamp_in(change: &Path, base: &Path) -> Option<String> {
        compute_stamp(change, base)
    }

    fn state_in(change: &Path, base: &Path) -> Approval {
        approval_state(change, base)
    }

    fn ok<T>(s: Section<T>) -> T {
        match s {
            Section::Ok(v) => v,
            _ => panic!("expected an ok section"),
        }
    }

    fn task_ids(w: &WaveGroup) -> Vec<&str> {
        w.tasks.iter().map(|t| t.id.as_str()).collect()
    }

    #[test]
    fn the_golden_fixture_gives_the_agent_hub_stamp_and_reads_stale_until_its_line_matches() {
        let d = golden("# Approval\n\nstamp: 000000000000\n\n## User's words\n\nok\n");
        assert_eq!(stamp_of(d.path()).as_deref(), Some(GOLDEN_STAMP));
        assert_eq!(state_of(d.path()), Approval::Stale);
        put(d.path(), "approval.md", STAMPED_WITH_GOLDEN);
        assert_eq!(state_of(d.path()), Approval::Approved);
    }

    #[test]
    fn a_stamp_equal_to_the_recomputed_stamp_reads_as_approved() {
        let d = golden(STAMPED_WITH_GOLDEN);
        assert_eq!(state_of(d.path()), Approval::Approved);
    }

    #[test]
    fn ticking_task_boxes_keeps_the_approval() {
        let d = golden(STAMPED_WITH_GOLDEN);
        put(
            d.path(),
            "tasks.md",
            &GOLDEN_TASKS
                .replace("- [ ] 1.2", "- [x] 1.2")
                .replace("- [ ] 2.1", "- [X] 2.1"),
        );
        assert_eq!(state_of(d.path()), Approval::Approved);
    }

    #[test]
    fn a_stamp_that_no_longer_matches_reads_as_needing_re_approval() {
        let new_task = format!("{GOLDEN_TASKS}- [ ] 2.2 More\n  Files: src/d.rs\n  Covers: none\n  Done when: x\n  Test: unit\n");
        let changed_files = GOLDEN_TASKS.replace("src/c.ts", "src/c.ts, src/e.ts");
        for tasks in [new_task, changed_files] {
            let d = golden(STAMPED_WITH_GOLDEN);
            put(d.path(), "tasks.md", &tasks);
            assert_eq!(state_of(d.path()), Approval::Stale);
        }
        let d = golden(STAMPED_WITH_GOLDEN);
        put(
            d.path(),
            "specs/a/spec.md",
            &format!("{GOLDEN_SPEC_A}\nmore\n"),
        );
        assert_eq!(state_of(d.path()), Approval::Stale);
        let d = golden(STAMPED_WITH_GOLDEN);
        put(d.path(), "specs/b/spec.md", GOLDEN_SPEC_A);
        assert_eq!(state_of(d.path()), Approval::Stale);
    }

    #[test]
    fn a_present_stamp_with_no_readable_tasks_md_reads_as_needing_re_approval() {
        let d = golden(STAMPED_WITH_GOLDEN);
        std::fs::remove_file(d.path().join("tasks.md")).unwrap();
        assert_eq!(stamp_of(d.path()), None);
        assert_eq!(state_of(d.path()), Approval::Stale);
    }

    #[test]
    fn a_change_without_a_stamp_line_reads_as_not_approved() {
        let d = golden("# Approval\n\nstamp: 64519d38be2\n");
        assert_eq!(state_of(d.path()), Approval::NotApproved, "11 hex digits");
        for text in [
            "stamp: 64519D38BE24\n",
            "stamp: 64519d38be245\n",
            "stamp: 64519d38be2g\n",
            "# Approval\n\nno stamp here\n",
            "  stamp: 64519d38be24\n",
            "",
        ] {
            put(d.path(), "approval.md", text);
            assert_eq!(state_of(d.path()), Approval::NotApproved, "{text:?}");
        }
        std::fs::remove_file(d.path().join("approval.md")).unwrap();
        assert_eq!(state_of(d.path()), Approval::NotApproved, "no approval.md");
    }

    #[test]
    fn the_first_well_formed_stamp_line_decides_and_a_malformed_one_before_it_is_skipped() {
        let d = golden("stamp: oops\nstamp:   64519d38be24   \n\n## Earlier approvals\n\nstamp: 000000000000\n");
        assert_eq!(state_of(d.path()), Approval::Approved);
    }

    #[test]
    fn ticked_and_unticked_task_lines_are_counted() {
        let t = ok(tasks_section(
            "## Wave 1\n\n- [x] 1.1 A\n- [X] 1.2 B\n- [ ] 2.1 C\n",
        ));
        assert_eq!((t.done, t.total), (2, 3));
    }

    #[test]
    fn lines_that_are_not_task_lines_are_not_counted() {
        let text = "## Wave 1\n\n- [ ] 1.1 A\n- [ ] 3 no dotted id\n- [x] note\n  Files: a.rs\n* [ ] 1.2 star bullet\n  - [ ] 1.3 indented\n- [ ] 1.4.1 three parts\n- [ ] 1.5\n- [y] 1.6 bad box\n- [] 1.7 no box\n";
        let t = ok(tasks_section(text));
        assert_eq!((t.done, t.total), (0, 1));
        assert_eq!(
            t.waves[0].tasks[0],
            TaskItem {
                id: "1.1".into(),
                title: "A".into(),
                done: false
            }
        );
    }

    #[test]
    fn tasks_are_grouped_by_wave_and_a_task_outside_a_wave_is_ungrouped() {
        let text = "# Tasks\n\n- [ ] 3.1 Loose\n\n## Wave 1\n\n- [x] 1.1 A\n- [x] 1.2 B\n\n## Wave 2\n\n- [ ] 2.1 C\n";
        let t = ok(tasks_section(text));
        let shape: Vec<(Option<u32>, u32, u32, Vec<&str>)> = t
            .waves
            .iter()
            .map(|w| (w.wave, w.done, w.total, task_ids(w)))
            .collect();
        assert_eq!(
            shape,
            vec![
                (Some(1), 2, 2, vec!["1.1", "1.2"]),
                (Some(2), 0, 1, vec!["2.1"]),
                (None, 0, 1, vec!["3.1"]),
            ]
        );
    }

    #[test]
    fn another_heading_or_a_malformed_wave_heading_ends_the_wave() {
        let text = "## Wave 1\n\n- [ ] 1.1 In\n\n## Notes\n\n- [ ] 8.1 After notes\n\n## Wave 2\n\n- [ ] 2.1 In two\n\n## Wave two\n\n- [ ] 9.1 After a malformed heading\n\n## Wave 3\n\n### Wave 3b\n\n- [ ] 9.2 After a sub heading\n\n## wave 4\n\n- [ ] 9.3 After a lower case heading\n\n## Wave 5\n\n### Details\n\n- [ ] 5.1 Still wave five\n";
        let t = ok(tasks_section(text));
        let shape: Vec<(Option<u32>, Vec<&str>)> =
            t.waves.iter().map(|w| (w.wave, task_ids(w))).collect();
        assert_eq!(
            shape,
            vec![
                (Some(1), vec!["1.1"]),
                (Some(2), vec!["2.1"]),
                (Some(5), vec!["5.1"]),
                (None, vec!["8.1", "9.1", "9.2", "9.3"]),
            ]
        );
    }

    #[test]
    fn a_tasks_file_without_task_lines_is_shown_as_written_and_a_blank_one_has_no_tasks() {
        let prose = "# Tasks\n\nJust prose, and - [ ] not at the line start.\n";
        assert_eq!(
            tasks_section(prose),
            Section::Unreadable {
                raw: prose.to_string()
            }
        );
        for blank in ["", "\n\n  \n"] {
            let t = ok(tasks_section(blank));
            assert_eq!((t.done, t.total, t.waves.len()), (0, 0, 0), "{blank:?}");
        }
    }

    #[test]
    fn review_sections_show_newest_first() {
        let text = "# Review\n\nintro dropped\n\n## Round 1 · independent\n\nfirst body\n\n## Round 2 · task 2.1\n\nsecond body\n\n## Findings\n\nstays inside round 2\n";
        let r = ok(review_section(text));
        let shape: Vec<(u32, &str, &str)> = r
            .rounds
            .iter()
            .map(|x| (x.n, x.kind.as_str(), x.markdown.as_str()))
            .collect();
        assert_eq!(
            shape,
            vec![
                (
                    2,
                    "task 2.1",
                    "second body\n\n## Findings\n\nstays inside round 2"
                ),
                (1, "independent", "first body"),
            ]
        );
    }

    #[test]
    fn two_review_sections_of_one_round_keep_the_later_one_first() {
        let r = ok(review_section(
            "## Round 1 · task 1.1\na\n## Round 2 · independent\nb\n## Round 2 · explore\nc\n",
        ));
        let kinds: Vec<&str> = r.rounds.iter().map(|x| x.kind.as_str()).collect();
        assert_eq!(kinds, vec!["explore", "independent", "task 1.1"]);
    }

    #[test]
    fn a_review_file_without_round_headings_is_shown_as_written_and_a_blank_one_has_no_rounds() {
        let notes = "# Notes\n\n## Round x · bad\n## Round 3 - wrong dot\n## Round 4 · \n";
        assert_eq!(
            review_section(notes),
            Section::Unreadable {
                raw: notes.to_string()
            }
        );
        assert!(ok(review_section("\n \n")).rounds.is_empty());
    }

    #[test]
    fn the_section_states_serialise_as_the_renderer_expects() {
        let missing = serde_json::to_value(Section::<TasksOk>::Missing).unwrap();
        assert_eq!(missing, serde_json::json!({ "state": "missing" }));
        let raw = serde_json::to_value(Section::<TasksOk>::Unreadable { raw: "x".into() }).unwrap();
        assert_eq!(
            raw,
            serde_json::json!({ "state": "unreadable", "raw": "x" })
        );
        let error = serde_json::to_value(Section::<TasksOk>::Error {
            message: "no permission".into(),
        })
        .unwrap();
        assert_eq!(
            error,
            serde_json::json!({ "state": "error", "message": "no permission" })
        );
        let tasks = serde_json::to_value(tasks_section("## Wave 1\n- [x] 1.1 A\n")).unwrap();
        assert_eq!(
            tasks,
            serde_json::json!({ "state": "ok", "done": 1, "total": 1, "waves": [
                { "wave": 1, "done": 1, "total": 1, "tasks": [{ "id": "1.1", "title": "A", "done": true }] }
            ] })
        );
        let review =
            serde_json::to_value(review_section("## Round 1 · independent\nbody\n")).unwrap();
        assert_eq!(
            review,
            serde_json::json!({ "state": "ok", "rounds": [{ "n": 1, "kind": "independent", "markdown": "body" }] })
        );
        for (a, s) in [
            (Approval::Approved, "approved"),
            (Approval::NotApproved, "not_approved"),
            (Approval::Stale, "stale"),
        ] {
            assert_eq!(serde_json::to_value(a).unwrap(), serde_json::json!(s));
        }
    }

    #[test]
    fn section_of_tells_a_missing_file_from_one_that_cannot_be_read() {
        let d = TempDir::new().unwrap();
        assert_eq!(
            section_of(&d.path().join("tasks.md"), tasks_section),
            Section::Missing
        );
        put(d.path(), "tasks.md", "- [ ] 1.1 A\n");
        assert_eq!(
            ok(section_of(&d.path().join("tasks.md"), tasks_section)).total,
            1
        );
        std::fs::create_dir(d.path().join("review.md")).unwrap();
        assert!(matches!(
            section_of(&d.path().join("review.md"), review_section),
            Section::Error { .. }
        ));
    }

    #[test]
    fn a_read_error_is_an_error_section_not_file_text() {
        let d = TempDir::new().unwrap();
        put(d.path(), "big/tasks.md", &"x".repeat(2 * 1024 * 1024 + 1));
        assert_eq!(
            read_text(&d.path().join("big/tasks.md")).unwrap_err(),
            "file larger than 2 MiB"
        );
        assert_eq!(
            section_of(&d.path().join("big/tasks.md"), tasks_section),
            Section::Error {
                message: "file larger than 2 MiB".to_string()
            }
        );
        std::fs::create_dir_all(d.path().join("dir/tasks.md")).unwrap();
        assert!(matches!(
            section_of(&d.path().join("dir/tasks.md"), tasks_section),
            Section::Error { .. }
        ));
    }

    /// One task block holding every key plan-check asks for.
    fn block(id: &str, files: &str) -> String {
        format!("- [ ] {id} T\n  Files: {files}\n  Covers: none\n  Done when: x\n  Test: unit\n")
    }

    #[test]
    fn task_ids_sort_by_their_numbers_not_their_text_and_equal_numbers_keep_file_order() {
        let tasks = |ids: [(&str, &str); 3]| {
            let blocks: String = ids.iter().map(|(id, files)| block(id, files)).collect();
            format!("## Wave 1\n{blocks}")
        };
        let a = golden("");
        put(
            a.path(),
            "tasks.md",
            &tasks([("1.10", "x"), ("1.2", "y"), ("01.2", "z")]),
        );
        let b = golden("");
        put(
            b.path(),
            "tasks.md",
            &tasks([("01.2", "z"), ("1.2", "y"), ("1.10", "x")]),
        );
        assert!(stamp_of(a.path()).is_some());
        assert_ne!(
            stamp_of(a.path()),
            stamp_of(b.path()),
            "1.2 before 01.2 versus after it"
        );
        let c = golden("");
        put(
            c.path(),
            "tasks.md",
            &tasks([("1.2", "y"), ("01.2", "z"), ("1.10", "x")]),
        );
        assert_eq!(
            stamp_of(a.path()),
            stamp_of(c.path()),
            "1.10 sorts after 1.2 whatever the file order"
        );
    }

    #[test]
    fn files_before_any_task_are_ignored_and_a_key_line_after_a_heading_still_attaches() {
        let base = format!(
            "## Wave 1\n{}## Notes\n  Files: b.rs\n",
            block("1.1", "a.rs")
        );
        let d = golden("");
        put(d.path(), "tasks.md", &base);
        let first = stamp_of(d.path());
        assert!(first.is_some());
        put(d.path(), "tasks.md", &format!("  Files: stray.rs\n{base}"));
        assert_eq!(
            stamp_of(d.path()),
            first,
            "a key line before any task goes nowhere"
        );
        put(
            d.path(),
            "tasks.md",
            &base.replace("  Files: b.rs\n", "  Files: c.rs\n"),
        );
        assert_ne!(
            stamp_of(d.path()),
            first,
            "a key line after a heading still attaches to the current task"
        );
    }

    #[test]
    fn a_linked_spec_file_enters_the_stamp_and_a_linked_folder_is_not_walked() {
        let d = golden("");
        let before = stamp_of(d.path());
        let outside = TempDir::new().unwrap();
        put(outside.path(), "extra/spec.md", "linked folder content\n");
        std::os::unix::fs::symlink(outside.path().join("extra"), d.path().join("specs/linked"))
            .unwrap();
        assert_eq!(stamp_of(d.path()), before, "a linked folder is not walked");
        put(d.path(), "proposal.md", "inside the folder\n");
        std::os::unix::fs::symlink(d.path().join("proposal.md"), d.path().join("specs/link.md"))
            .unwrap();
        assert_ne!(
            stamp_of(d.path()),
            before,
            "a link to a file inside the base is followed"
        );
        std::fs::remove_file(d.path().join("specs/link.md")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("extra/spec.md"),
            d.path().join("specs/link.md"),
        )
        .unwrap();
        assert_eq!(
            stamp_of(d.path()),
            None,
            "a link to a file outside the base gives no stamp"
        );
    }

    /// A plan base `B` holding the change `B/changes/foo` (the golden fixture, approved) and a folder `B/shared`;
    /// `O` is a place outside `B` with copies of the golden files.
    struct Linked {
        _b: TempDir,
        outside: TempDir,
        base: PathBuf,
        change: PathBuf,
    }

    fn linked() -> Linked {
        let b = TempDir::new().unwrap();
        let base = b.path().canonicalize().unwrap();
        let change = base.join("changes/foo");
        golden_at(&change, STAMPED_WITH_GOLDEN);
        let outside = TempDir::new().unwrap();
        golden_at(outside.path(), STAMPED_WITH_GOLDEN);
        Linked {
            _b: b,
            outside,
            base,
            change,
        }
    }

    fn replace_with_link(path: &Path, to: &Path) {
        if path.is_dir() && !path.is_symlink() {
            std::fs::remove_dir_all(path).unwrap();
        } else {
            std::fs::remove_file(path).unwrap();
        }
        std::os::unix::fs::symlink(to, path).unwrap();
    }

    #[test]
    fn a_linked_out_stamp_input_never_reads_approved() {
        let l = linked();
        assert_eq!(state_in(&l.change, &l.base), Approval::Approved);
        assert_eq!(stamp_in(&l.change, &l.base).as_deref(), Some(GOLDEN_STAMP));

        replace_with_link(
            &l.change.join("tasks.md"),
            &l.outside.path().join("tasks.md"),
        );
        assert_eq!(stamp_in(&l.change, &l.base), None, "tasks.md linked out");
        assert_eq!(state_in(&l.change, &l.base), Approval::Stale);

        let l = linked();
        replace_with_link(&l.change.join("specs"), &l.outside.path().join("specs"));
        assert_eq!(stamp_in(&l.change, &l.base), None, "specs/ linked out");
        assert_eq!(state_in(&l.change, &l.base), Approval::Stale);

        let l = linked();
        replace_with_link(
            &l.change.join("specs/a/spec.md"),
            &l.outside.path().join("specs/a/spec.md"),
        );
        assert_eq!(
            stamp_in(&l.change, &l.base),
            None,
            "one spec file linked out"
        );
        assert_eq!(state_in(&l.change, &l.base), Approval::Stale);

        let l = linked();
        replace_with_link(
            &l.change.join("approval.md"),
            &l.outside.path().join("approval.md"),
        );
        assert_eq!(
            state_in(&l.change, &l.base),
            Approval::NotApproved,
            "approval.md linked out"
        );
    }

    #[test]
    fn a_link_that_stays_inside_the_plan_base_is_still_followed() {
        let l = linked();
        put(&l.base, "shared/tasks.md", GOLDEN_TASKS);
        replace_with_link(&l.change.join("tasks.md"), &l.base.join("shared/tasks.md"));
        put(&l.base, "shared/spec.md", GOLDEN_SPEC_A);
        replace_with_link(
            &l.change.join("specs/a/spec.md"),
            &l.base.join("shared/spec.md"),
        );
        assert_eq!(
            stamp_in(&l.change, &l.base).as_deref(),
            Some(GOLDEN_STAMP),
            "same bytes through links inside the base"
        );
        assert_eq!(state_in(&l.change, &l.base), Approval::Approved);
        put(&l.base, "shared/spec.md", "changed\n");
        assert_eq!(
            state_in(&l.change, &l.base),
            Approval::Stale,
            "the linked bytes count"
        );
    }

    #[test]
    fn a_large_tasks_md_scans_in_linear_time() {
        let one_wave: String = std::iter::once("## Wave 1\n".to_string())
            .chain((0..100_000).map(|i| format!("- [ ] 1.{i} t\n")))
            .collect();
        let one_task_waves: String = (0..50_000)
            .map(|i| format!("## Wave {i}\n- [ ] 1.{i} t\n"))
            .collect();
        for (text, waves, tasks) in [(one_wave, 1, 100_000), (one_task_waves, 50_000, 50_000)] {
            assert!((text.len() as u64) < MAX_BYTES);
            let d = TempDir::new().unwrap();
            put(d.path(), "tasks.md", &text);
            let started = std::time::Instant::now();
            let section = ok(tasks_section(&text));
            let stamp = stamp_of(d.path());
            let took = started.elapsed();
            assert!(
                took < std::time::Duration::from_secs(5),
                "{tasks} tasks took {took:?}"
            );
            assert_eq!((section.total, section.waves.len()), (tasks, waves));
            assert_eq!(stamp, None, "no task has its key lines");
        }
    }

    #[test]
    fn a_specs_walk_over_budget_gives_no_stamp() {
        let d = golden(STAMPED_WITH_GOLDEN);
        assert_eq!(stamp_of(d.path()).as_deref(), Some(GOLDEN_STAMP));
        for i in 0..1_001 {
            put(d.path(), &format!("specs/many/{i}.md"), "");
        }
        assert_eq!(stamp_of(d.path()), None, "1,001 files under specs/");
        assert_eq!(state_of(d.path()), Approval::Stale);

        let d = golden(STAMPED_WITH_GOLDEN);
        for i in 0..5 {
            put(
                d.path(),
                &format!("specs/big/{i}.md"),
                &"a".repeat(1_900_000),
            );
        }
        assert_eq!(stamp_of(d.path()), None, "five 1.9 MB files, 9.5 MB in all");
    }

    // Golden values below are plan-check.py's own (agent-hub 0.2.5 `compute_stamp`, run on the same bytes), never
    // this module's.

    /// `tasks` and `approval` in a change folder with no `specs/`.
    fn without_specs(tasks: &str, approval: &str) -> TempDir {
        let d = TempDir::new().unwrap();
        put(d.path(), "tasks.md", tasks);
        put(d.path(), "approval.md", approval);
        d
    }

    /// A one-task fixture whose key lines are joined by `sep` and indented by `indent`.
    fn one_task(sep: &str, indent: &str) -> String {
        let keys = [
            "Files: src/a.rs",
            "Covers: none",
            "Done when: ok",
            "Test: unit",
        ];
        let body: String = keys.iter().map(|k| format!("{sep}{indent}{k}")).collect();
        format!("## Wave 1\n- [ ] 1.1 A{body}\n")
    }

    const ONE_TASK_STAMP: &str = "0179b621f341";

    #[test]
    fn a_lone_carriage_return_hides_no_task_from_the_stamp() {
        let appended = GOLDEN_TASKS.replace(
            "  Test: unit\n- [ ] 1.2",
            "  Test: unit\r- [ ] 1.9 New task\r  Files: src/evil.rs\r  Covers: none\r  Done when: x\r  Test: unit\n- [ ] 1.2",
        );
        let on_task_line = GOLDEN_TASKS.replace(
            "- [x] 1.10 Later task\n",
            "- [x] 1.10 Later task\r- [ ] 1.9 New task\r  Files: src/evil.rs\n",
        );
        for (tasks, stamp) in [(appended, Some("1045deab68e1")), (on_task_line, None)] {
            let d = golden(STAMPED_WITH_GOLDEN);
            put(d.path(), "tasks.md", &tasks);
            assert_eq!(stamp_of(d.path()).as_deref(), stamp);
            assert_eq!(state_of(d.path()), Approval::Stale);
        }
    }

    #[test]
    fn unicode_line_breaks_split_lines_as_plan_check_does() {
        for sep in [
            "\n", "\r\n", "\r", "\x0b", "\x0c", "\x1c", "\x1d", "\x1e", "\u{85}", "\u{2028}",
            "\u{2029}",
        ] {
            let d = without_specs(&one_task(sep, "  "), "");
            assert_eq!(
                stamp_of(d.path()).as_deref(),
                Some(ONE_TASK_STAMP),
                "{sep:?}"
            );
        }
    }

    #[test]
    fn a_key_line_indented_by_a_unit_separator_counts_as_plan_check_does() {
        let d = golden(STAMPED_WITH_GOLDEN);
        put(
            d.path(),
            "tasks.md",
            &GOLDEN_TASKS.replace(
                "  Files: src/b.rs, src/a.rs\n",
                "  Files: src/b.rs, src/a.rs\n\x1fFiles: src/evil.rs\n",
            ),
        );
        assert_eq!(stamp_of(d.path()).as_deref(), Some("dce9e8760035"));
        assert_eq!(state_of(d.path()), Approval::Stale);
        let d = without_specs(&one_task("\n", "\x1f"), "");
        assert_eq!(stamp_of(d.path()).as_deref(), Some(ONE_TASK_STAMP));
    }

    #[test]
    fn a_spec_file_over_2_mib_gives_no_stamp() {
        let d = golden(STAMPED_WITH_GOLDEN);
        assert_eq!(stamp_of(d.path()).as_deref(), Some(GOLDEN_STAMP));
        put(
            d.path(),
            "specs/a/spec.md",
            &"x".repeat(2 * 1024 * 1024 + 1),
        );
        assert_eq!(stamp_of(d.path()), None);
        assert_eq!(state_of(d.path()), Approval::Stale);
        put(d.path(), "specs/a/spec.md", &"x".repeat(2 * 1024 * 1024));
        assert!(stamp_of(d.path()).is_some(), "exactly 2 MiB is still read");
    }

    #[test]
    fn a_later_key_line_of_a_task_overwrites_the_earlier_one() {
        let d = golden("");
        put(
            d.path(),
            "tasks.md",
            &GOLDEN_TASKS.replace(
                "  Files:   src/c.ts  \n",
                "  Files:   src/c.ts  \n  Files: src/d.ts\n",
            ),
        );
        assert_eq!(stamp_of(d.path()).as_deref(), Some("0474fcf1447a"));
    }

    #[test]
    fn a_title_ending_in_a_unit_separator_and_files_before_any_task_leave_the_golden_stamp() {
        for tasks in [
            GOLDEN_TASKS.replace("- [ ] 1.2 Earlier task", "- [ ] 1.2 Earlier task\x1f"),
            format!("  Files: stray.rs\n{GOLDEN_TASKS}"),
        ] {
            let d = golden("");
            put(d.path(), "tasks.md", &tasks);
            assert_eq!(stamp_of(d.path()).as_deref(), Some(GOLDEN_STAMP));
        }
    }

    #[test]
    fn a_task_id_in_non_ascii_digits_never_reads_as_approved() {
        let arabic = "- [ ] \u{661}.\u{661} x\n";
        for tasks in [
            format!("{GOLDEN_TASKS}{arabic}  Files: src/z.rs\n  Covers: none\n  Done when: x\n  Test: unit\n"),
            format!("{GOLDEN_TASKS}{arabic}"),
        ] {
            let d = golden(STAMPED_WITH_GOLDEN);
            put(d.path(), "tasks.md", &tasks);
            assert_eq!(state_of(d.path()), Approval::Stale);
        }
    }

    #[test]
    fn a_line_rust_and_python_could_classify_differently_gives_no_stamp() {
        // plan-check accepts the first two and rejects the last; Rust cannot tell them apart, so none is approved.
        for (from, to) in [
            ("## Wave 2", "## Wave \u{662}"),
            ("## Wave 2", "## Wave 2\u{345}"),
            ("- [ ] 1.2 Earlier", "# Wave\u{345}\n- [ ] 1.2 Earlier"),
        ] {
            let d = golden(STAMPED_WITH_GOLDEN);
            put(d.path(), "tasks.md", &GOLDEN_TASKS.replace(from, to));
            assert_eq!(stamp_of(d.path()), None, "{to:?}");
            assert_eq!(state_of(d.path()), Approval::Stale, "{to:?}");
        }
    }

    #[test]
    fn the_first_stamp_match_wins_as_in_plan_check() {
        let good = GOLDEN_STAMP;
        for (approval, expected) in [
            (
                format!("x\rstamp: 000000000000\nstamp: {good}\n"),
                Approval::Stale,
            ),
            (format!("stamp:\n{good}\n"), Approval::Approved),
            (format!("stamp:\x1f{good}\n"), Approval::Approved),
            (
                format!("# Approval\r\nstamp: {good}\r\n"),
                Approval::Approved,
            ),
            (format!("stamp: {good}\x0b"), Approval::Approved),
            (format!("stamp: {good} \x1cx\n"), Approval::NotApproved),
            (format!("x\u{2028}stamp: {good}\n"), Approval::NotApproved),
        ] {
            let d = golden(&approval);
            assert_eq!(state_of(d.path()), expected, "{approval:?}");
        }
    }

    #[test]
    fn a_folder_failing_plan_check_check_1_is_never_approved() {
        let loose =
            "- [ ] 0.1 Loose\n  Files: src/x.rs\n  Covers: none\n  Done when: x\n  Test: unit\n";
        let dup = format!("{GOLDEN_TASKS}- [ ] 1.2 Earlier task again\n  Files: src/ignored.rs\n  Covers: none\n  Done when: x\n  Test: unit\n");
        let no_test = GOLDEN_TASKS.replace(
            "  Done when: it works\n  Test: unit\n\n## Wave 2",
            "  Done when: it works\n\n## Wave 2",
        );
        let no_files = GOLDEN_TASKS.replace("  Files: docs/ghi-chú.md\n", "");
        let empty_covers = GOLDEN_TASKS.replace(
            "  Covers: none\n  Done when: it works\n  Test: script",
            "  Covers:\n  Done when: it works\n  Test: script",
        );
        // Each stamp is plan-check's `compute_stamp` of the folder, which skips check 1; the approval holds it.
        for (what, tasks, stamp) in [
            ("a repeated id", dup, GOLDEN_STAMP),
            (
                "a task above the first wave",
                format!("{loose}{GOLDEN_TASKS}"),
                "d009c4836ba4",
            ),
            (
                "# Wave 1 as the only wave heading",
                GOLDEN_TASKS.replace("## Wave 1", "# Wave 1"),
                GOLDEN_STAMP,
            ),
            ("a task without Test", no_test, GOLDEN_STAMP),
            ("a task without Files", no_files, "7ca79952522e"),
            ("an empty Covers", empty_covers, GOLDEN_STAMP),
            (
                "a malformed wave heading",
                GOLDEN_TASKS.replace("## Wave 2", "## Wave two"),
                GOLDEN_STAMP,
            ),
        ] {
            let d = golden(&format!("stamp: {stamp}\n"));
            put(d.path(), "tasks.md", &tasks);
            assert_eq!(stamp_of(d.path()), None, "{what}");
            assert_eq!(state_of(d.path()), Approval::Stale, "{what}");
        }
    }

    #[test]
    fn the_module_has_no_write_call() {
        let src = include_str!("plan_files.rs");
        let body = &src[..src.find("#[cfg(test)]").unwrap()];
        for w in [
            "fs::write",
            "File::create",
            "create_dir",
            "remove_file",
            "OpenOptions",
            "rename(",
        ] {
            assert!(!body.contains(w), "{w}");
        }
    }
}
