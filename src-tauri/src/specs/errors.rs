//! The rounds of an `errors.yaml`, by an indentation-aware line scan (design D6); there is no YAML parser
//! in the app and agent-hub itself appends to the file as text. Read only.
//!
//! Two readers share one pass over the lines: `errors_section` summarises every round for the change
//! detail and refuses a shape it does not know, `round_spans` only finds where each round item sits
//! so the Memory tab can show one entry per round.

use super::plan_files::Section;
use serde::Serialize;
use std::ops::Range;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Red,
    Yellow,
    Green,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ErrorRound {
    pub n: u32,
    pub verdict: Verdict,
    /// Entries of the round without a closing `closed_in`, by severity.
    pub critical: u32,
    pub major: u32,
    pub minor: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ErrorsOk {
    pub rounds: Vec<ErrorRound>,
}

/// One non-blank, non-comment line outside any block scalar: its 0-based line number, its indent and its
/// text from the first non-space character, trailing spaces dropped.
struct Ln<'a> {
    no: usize,
    indent: usize,
    body: &'a str,
}

/// The `- ` prefixes of `body`: the columns they take and what follows them.
fn after_dashes(body: &str) -> (usize, &str) {
    let (mut cols, mut rest) = (0, body);
    while let Some(r) = rest.strip_prefix("- ") {
        let t = r.trim_start_matches(' ');
        cols += rest.len() - t.len();
        rest = t;
    }
    (cols, rest)
}

/// `key: value` split at the first colon that ends the line or is followed by a space; the value is trimmed.
fn split_key(body: &str) -> Option<(&str, &str)> {
    let at = body
        .match_indices(':')
        .map(|(i, _)| i)
        .find(|&i| matches!(body.as_bytes().get(i + 1), None | Some(b' ')))?;
    Some((body[..at].trim(), body[at + 1..].trim()))
}

/// A scalar value without its trailing ` # comment` and its quotes.
fn scalar(value: &str) -> &str {
    let v = if value.starts_with('#') {
        ""
    } else {
        value.split(" #").next().unwrap_or("")
    }
    .trim();
    let quoted = v.len() >= 2
        && matches!(v.as_bytes()[0], b'"' | b'\'')
        && v.as_bytes()[0] == v.as_bytes()[v.len() - 1];
    if quoted {
        &v[1..v.len() - 1]
    } else {
        v
    }
}

/// The lines that carry structure. A key whose value starts with `|` or `>` opens a block scalar: the blank
/// lines and the lines indented deeper than that key after it are text, never keys or items (D6 step 4).
fn content_lines(text: &str) -> Vec<Ln<'_>> {
    let mut out = Vec::new();
    let mut scalar_key: Option<usize> = None;
    for (no, raw) in text.lines().enumerate() {
        let line = raw.trim_end();
        let indent = line.len() - line.trim_start_matches(' ').len();
        if line.is_empty() || scalar_key.is_some_and(|k| indent > k) {
            continue;
        }
        scalar_key = None;
        let body = &line[indent..];
        if body.starts_with('#') {
            continue;
        }
        let (cols, rest) = after_dashes(body);
        if split_key(rest).is_some_and(|(_, v)| v.starts_with(['|', '>'])) {
            scalar_key = Some(indent + cols);
        }
        out.push(Ln { no, indent, body });
    }
    out
}

fn is_item(l: &Ln) -> bool {
    l.body.starts_with("- ")
}

enum Block<'a> {
    /// No column-0 `errors:` line.
    Absent,
    /// `errors: []`.
    Empty,
    /// A flow value other than `[]`, or an `errors:` with nothing under it.
    Bad,
    /// The lines under `errors:`, and the line number of the column-0 key that ended them.
    Lines(&'a [Ln<'a>], Option<usize>),
}

/// D6 step 1: the block under a column-0 `errors:` runs to the next column-0 line that is not an item.
fn errors_block<'a>(lines: &'a [Ln<'a>]) -> Block<'a> {
    let Some(at) = lines
        .iter()
        .position(|l| l.indent == 0 && split_key(l.body).is_some_and(|(k, _)| k == "errors"))
    else {
        return Block::Absent;
    };
    match split_key(lines[at].body).map_or("", |(_, v)| scalar(v)) {
        "[]" => return Block::Empty,
        "" => {}
        _ => return Block::Bad,
    }
    let rest = &lines[at + 1..];
    let len = rest
        .iter()
        .position(|l| l.indent == 0 && !is_item(l))
        .unwrap_or(rest.len());
    if len == 0 {
        return Block::Bad;
    }
    Block::Lines(&rest[..len], rest.get(len).map(|l| l.no))
}

/// D6 step 2: the round items of a block, each as its own lines; None when a line is shallower than the
/// first item or sits at its indent without a dash.
fn round_items<'a>(block: &'a [Ln<'a>]) -> Option<Vec<&'a [Ln<'a>]>> {
    let indent = block[0].indent;
    let mut items = Vec::new();
    let mut start = 0;
    for (i, l) in block.iter().enumerate() {
        if l.indent < indent || (l.indent == indent && !is_item(l)) {
            return None;
        }
        if l.indent == indent && i > 0 {
            items.push(&block[start..i]);
            start = i;
        }
    }
    items.push(&block[start..]);
    Some(items)
}

/// D6 step 3: the entries under an `entries:` key at `key_indent`, `lines` being what follows the key. Returns
/// the open count per severity (critical, major, minor) and how many lines the entries took.
fn open_entries(lines: &[Ln], key_indent: usize) -> Option<([u32; 3], usize)> {
    let indent = lines
        .first()
        .filter(|l| l.indent >= key_indent && is_item(l))?
        .indent;
    let end = lines
        .iter()
        .position(|l| l.indent < indent || (l.indent == indent && !is_item(l)))
        .unwrap_or(lines.len());
    let mut open = [0; 3];
    let mut start = 0;
    for i in 1..=end {
        if i == end || lines[i].indent == indent {
            let (severity, closed) = entry_state(&lines[start..i])?;
            open[severity] += u32::from(!closed);
            start = i;
        }
    }
    Some((open, end))
}

/// The severity (0 critical, 1 major, 2 minor) of an entry and whether its `closed_in` closes it.
fn entry_state(entry: &[Ln]) -> Option<(usize, bool)> {
    let (cols, first) = after_dashes(entry[0].body);
    let key_indent = entry[0].indent + cols;
    let (mut severity, mut closed) = (None, false);
    for (j, l) in entry.iter().enumerate() {
        let (indent, body) = if j == 0 {
            (key_indent, first)
        } else {
            (l.indent, l.body)
        };
        let Some((key, value)) = split_key(body).filter(|_| indent == key_indent) else {
            continue;
        };
        match key {
            "severity" if severity.is_none() => {
                severity = Some(
                    ["critical", "major", "minor"]
                        .iter()
                        .position(|s| *s == scalar(value))?,
                );
            }
            "closed_in" => closed = !matches!(scalar(value), "" | "null" | "~"),
            _ => {}
        }
    }
    Some((severity?, closed))
}

fn round_state(item: &[Ln]) -> Option<ErrorRound> {
    let (cols, first) = after_dashes(item[0].body);
    let key_indent = item[0].indent + cols;
    let (mut n, mut verdict, mut open) = (None, None, None);
    let mut i = 0;
    while i < item.len() {
        let (indent, body) = if i == 0 {
            (key_indent, first)
        } else {
            (item[i].indent, item[i].body)
        };
        i += 1;
        let Some((key, value)) = split_key(body).filter(|_| indent == key_indent) else {
            continue;
        };
        match key {
            "round" if n.is_none() => n = Some(scalar(value).parse::<u32>().ok()?),
            "verdict" if verdict.is_none() => {
                verdict = Some(match scalar(value) {
                    "red" => Verdict::Red,
                    "yellow" => Verdict::Yellow,
                    "green" => Verdict::Green,
                    _ => return None,
                });
            }
            "entries" if open.is_none() => match scalar(value) {
                "[]" => open = Some([0; 3]),
                "" => {
                    let (counts, taken) = open_entries(&item[i..], key_indent)?;
                    open = Some(counts);
                    i += taken;
                }
                _ => return None,
            },
            _ => {}
        }
    }
    let [critical, major, minor] = open?;
    Some(ErrorRound {
        n: n?,
        verdict: verdict?,
        critical,
        major,
        minor,
    })
}

/// The rounds of `errors.yaml`, newest first (two rounds of one number: the later one first), each with its
/// open entries. A blank file has no round; any other file that is not the expected round list is shown as written.
pub fn errors_section(text: &str) -> Section<ErrorsOk> {
    if text.trim().is_empty() {
        return Section::Ok(ErrorsOk { rounds: Vec::new() });
    }
    let lines = content_lines(text);
    let rounds = match errors_block(&lines) {
        Block::Empty => Some(Vec::new()),
        Block::Lines(block, _) => {
            round_items(block).and_then(|items| items.into_iter().map(round_state).collect())
        }
        Block::Absent | Block::Bad => None,
    };
    let Some(mut rounds) = rounds else {
        return Section::Unreadable {
            raw: text.to_string(),
        };
    };
    rounds.reverse();
    rounds.sort_by_key(|r| std::cmp::Reverse(r.n));
    Section::Ok(ErrorsOk { rounds })
}

/// 0-based line ranges of the round items of `errors:`, in file order; empty when the text has no such list.
/// Values are not checked, only where each item starts and ends.
pub fn round_spans(text: &str) -> Vec<Range<usize>> {
    let lines = content_lines(text);
    let Block::Lines(block, next) = errors_block(&lines) else {
        return Vec::new();
    };
    let Some(items) = round_items(block) else {
        return Vec::new();
    };
    let starts: Vec<usize> = items.iter().map(|item| item[0].no).collect();
    let end = next.unwrap_or_else(|| text.lines().count());
    starts
        .iter()
        .zip(starts.iter().skip(1).chain([&end]))
        .map(|(&s, &e)| s..e)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A round as agent-hub writes it (`refs/roles/brainstorm/error-batch.md`), with the given `entries:` body.
    fn round(n: u32, verdict: &str, entries: &str) -> String {
        format!(
            "  - round: {n}\n    round_source: review-test\n    verdict: {verdict}\n    entries:{entries}\n    analysis: {{groups: [], fix_list: [], deferred_errors: []}}\n    user_decisions: []\n"
        )
    }

    fn entry(id: &str, severity: &str, closed_in: Option<&str>) -> String {
        let closed = closed_in
            .map(|c| format!("        closed_in: {c}\n"))
            .unwrap_or_default();
        format!("      - id: {id}\n        source: reviewer-independent\n        severity: {severity}\n{closed}        text: |\n          a finding\n")
    }

    fn file(rounds: &[String]) -> String {
        format!("meta:\n  plan: demo\nerrors:\n{}", rounds.concat())
    }

    fn ok(text: &str) -> Vec<ErrorRound> {
        match errors_section(text) {
            Section::Ok(v) => v.rounds,
            _ => panic!("expected an ok section for {text:?}"),
        }
    }

    fn raw(text: &str) {
        assert_eq!(
            errors_section(text),
            Section::Unreadable {
                raw: text.to_string()
            },
            "{text:?}"
        );
    }

    fn open(r: &ErrorRound) -> (u32, u32, u32) {
        (r.critical, r.major, r.minor)
    }

    #[test]
    fn an_entry_without_closed_in_is_counted_as_open() {
        let entries = format!(
            "\n{}{}{}",
            entry("E2-1", "critical", None),
            entry("E2-2", "minor", None),
            entry("E2-3", "minor", None)
        );
        let rounds = ok(&file(&[round(2, "red", &entries)]));
        assert_eq!(rounds.len(), 1);
        assert_eq!(
            (rounds[0].n, rounds[0].verdict, open(&rounds[0])),
            (2, Verdict::Red, (1, 0, 2))
        );
    }

    #[test]
    fn an_entry_with_closed_in_is_not_counted_as_open() {
        let entries = format!("\n{}", entry("E1-1", "major", Some("2")));
        let rounds = ok(&file(&[round(1, "yellow", &entries)]));
        assert_eq!(
            (rounds[0].verdict, open(&rounds[0])),
            (Verdict::Yellow, (0, 0, 0))
        );
    }

    #[test]
    fn an_empty_null_or_tilde_closed_in_keeps_the_entry_open() {
        for closed in ["", "null", "~", "# not yet", "null # later"] {
            let entries = format!("\n{}", entry("E1-1", "major", Some(closed)));
            let rounds = ok(&file(&[round(1, "red", &entries)]));
            assert_eq!(open(&rounds[0]), (0, 1, 0), "{closed:?}");
        }
        for closed in ["3", "\"3\"", "round-3", "3 # fixed"] {
            let entries = format!("\n{}", entry("E1-1", "major", Some(closed)));
            assert_eq!(
                open(&ok(&file(&[round(1, "red", &entries)]))[0]),
                (0, 0, 0),
                "{closed:?}"
            );
        }
    }

    #[test]
    fn a_well_formed_errors_yaml_is_summarised() {
        let rounds = ok("errors:\n  - round: 1\n    verdict: green\n    entries: []\n");
        assert_eq!(
            rounds,
            vec![ErrorRound {
                n: 1,
                verdict: Verdict::Green,
                critical: 0,
                major: 0,
                minor: 0
            }]
        );
        assert!(ok("errors: []\n").is_empty());
        assert!(ok("errors: [] # none yet\n").is_empty());
    }

    #[test]
    fn a_malformed_errors_yaml_is_shown_as_written() {
        raw("errors:\n  - round: 1\n    verdict: blue\n    entries: []\n");
        raw("errors:\n  - round: one\n    verdict: red\n    entries: []\n");
        raw("errors:\n  - round: -1\n    verdict: red\n    entries: []\n");
        raw("errors:\n  - verdict: red\n    entries: []\n");
        raw("errors:\n  - round: 1\n    entries: []\n");
        raw("errors:\n  - round: 1\n    verdict: red\n");
        raw("errors:\n  - round: 1\n    verdict: red\n    entries:\n      - id: E1\n        severity: urgent\n");
        raw("errors:\n  - round: 1\n    verdict: red\n    entries:\n      - id: E1\n        text: no severity\n");
        raw("errors:\n  - round: 1\n    verdict: red\n    entries: [E1]\n");
        raw("errors:\n  - round: 1\n    verdict: red\n    entries: none\n");
        raw("errors: [a, b]\n");
        raw("errors: nothing\n");
        raw("errors:\n");
        raw("errors:\n  notalist: 1\n");
        raw("errors:\n  - round: 1\n    verdict: red\n    entries: []\n - round: 2\n");
        raw("meta:\n  plan: demo\n");
        raw("- source: legacy\n  text: no errors key\n");
    }

    #[test]
    fn a_blank_errors_yaml_has_no_round() {
        assert!(ok("").is_empty());
        assert!(ok(" \n\n").is_empty());
    }

    #[test]
    fn rounds_come_newest_first_and_two_rounds_of_one_number_keep_the_later_one_first() {
        let text = file(&[
            round(1, "red", " []"),
            round(3, "green", " []"),
            round(2, "yellow", " []"),
            round(3, "red", " []"),
        ]);
        let order: Vec<(u32, Verdict)> = ok(&text).iter().map(|r| (r.n, r.verdict)).collect();
        assert_eq!(
            order,
            vec![
                (3, Verdict::Red),
                (3, Verdict::Green),
                (2, Verdict::Yellow),
                (1, Verdict::Red)
            ]
        );
    }

    #[test]
    fn quotes_and_trailing_comments_are_stripped_from_the_values() {
        let text = "errors:\n  - round: 2 # second\n    verdict: \"green\" # clean\n    entries:\n      - id: E1\n        severity: 'minor'\n";
        let r = ok(text);
        assert_eq!(
            (r[0].n, r[0].verdict, open(&r[0])),
            (2, Verdict::Green, (0, 0, 1))
        );
    }

    #[test]
    fn a_block_scalar_never_yields_keys_or_items() {
        let text = "errors:\n  - round: 1\n    verdict: red\n    entries:\n      - id: E1\n        severity: major\n        text: |\n          - round: 9\n          severity: critical\n          closed_in: 3\n          - id: E9\n            severity: minor\n\n          after a blank line\n      - id: E2\n        severity: minor\n        text: >-\n          verdict: green\n    analysis: {groups: [], fix_list: [], deferred_errors: []}\n";
        let r = ok(text);
        assert_eq!(r.len(), 1);
        assert_eq!((r[0].verdict, open(&r[0])), (Verdict::Red, (0, 1, 1)));
        assert_eq!(round_spans(text), vec![1..19]);
    }

    #[test]
    fn a_block_scalar_opened_at_a_shallower_indent_than_the_entry_keys_still_hides_its_text() {
        let text = "errors:\n  - round: 1\n    verdict: red\n    entries:\n      - id: E1\n        severity: major\n       note: |\n        closed_in: 3\n";
        assert_eq!(open(&ok(text)[0]), (0, 1, 0));
    }

    #[test]
    fn entries_may_sit_at_the_indent_of_their_key_and_a_following_key_ends_them() {
        let text = "errors:\n  - round: 1\n    verdict: red\n    entries:\n    - id: E1\n      severity: major\n    - id: E2\n      severity: critical\n      closed_in: 2\n    user_decisions:\n    - q: one\n";
        assert_eq!(open(&ok(text)[0]), (0, 1, 0));
    }

    #[test]
    fn rounds_may_sit_at_column_zero_and_other_top_level_keys_end_the_block() {
        let text = "errors:\n- round: 1\n  verdict: red\n  entries: []\n- round: 2\n  verdict: green\n  entries: []\nmeta:\n  note: x\n";
        assert_eq!(ok(text).iter().map(|r| r.n).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(round_spans(text), vec![1..4, 4..7]);
    }

    #[test]
    fn keys_of_other_rounds_and_nested_lists_are_not_mixed_up() {
        let text = "errors:\n  - round: 1\n    verdict: red\n    entries:\n      - id: E1\n        severity: major\n    analysis:\n      fix_list:\n        - id: FX-1-1\n          severity: critical\n  - round: 2\n    verdict: green\n    entries: []\n";
        let r = ok(text);
        assert_eq!((r[0].n, open(&r[0])), (2, (0, 0, 0)));
        assert_eq!((r[1].n, open(&r[1])), (1, (0, 1, 0)));
    }

    #[test]
    fn two_rounds_give_two_spans_each_starting_at_its_round_line() {
        let entries = format!(
            "\n{}{}",
            entry("E1-1", "major", None),
            entry("E1-2", "minor", None)
        );
        let text = file(&[round(1, "red", &entries), round(2, "green", " []")]);
        let spans = round_spans(&text);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(spans.len(), 2);
        for (span, n) in spans.iter().zip([1, 2]) {
            assert_eq!(lines[span.start], format!("  - round: {n}"));
        }
        assert_eq!(spans[0].end, spans[1].start);
        assert_eq!(spans[1].end, lines.len());
    }

    #[test]
    fn a_round_item_inside_an_entry_text_does_not_split_the_round() {
        let text = "errors:\n  - round: 1\n    verdict: red\n    entries:\n      - id: E1\n        severity: major\n        text: |\n          - round: 9\n";
        assert_eq!(round_spans(text), vec![1..8]);
    }

    #[test]
    fn a_text_without_a_round_list_has_no_spans() {
        for text in [
            "",
            "errors: []\n",
            "errors:\n",
            "meta:\n  x: 1\n",
            "- source: legacy\n  text: t\n",
            "errors:\n  notalist: 1\n",
            "errors: nothing\n",
        ] {
            assert!(round_spans(text).is_empty(), "{text:?}");
        }
    }

    #[test]
    fn spans_do_not_check_values() {
        let text = "errors:\n  - round: one\n    verdict: blue\n  - verdict: red\n";
        assert_eq!(round_spans(text), vec![1..3, 3..4]);
    }

    #[test]
    fn the_module_has_no_write_call() {
        let src = include_str!("errors.rs");
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
