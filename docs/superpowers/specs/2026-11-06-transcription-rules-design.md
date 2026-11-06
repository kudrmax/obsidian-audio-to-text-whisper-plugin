# Transcription rules: design and test cases

## Intent

Max wants to choose precisely which audio the **Transcribe audio** command transcribes. The two fixed switches (By tag, By daily note date) are replaced by a list of rules. The cost of an error is high: transcribing the wrong audio replaces the reference with text and trashes the recording. Every case below must have a test, and the run must refuse to start rather than guess.

## Model

- **Rule** = scope AND (optional) tag condition.
  - Scope `folders`: a list of folders, subfolders included. `/` is the whole vault. A folder matches a note when the note path starts with `<folder>/`; `Inbox` never matches `Inbox2/…`.
  - Scope `daily`: notes of Obsidian's Daily notes plugin (directly in its folder, named by its date format), optionally only those dated on or after `fromDate` (inclusive).
  - Tag condition: off → every audio reference in the matched notes; on → only references on a line that carries one of the rule's tags inline. A tag in frontmatter or elsewhere in the note never selects a line (Max: tags stand only on the line, a note-level tag case does not exist and never will).
  - `removeTagsAfter`: only for tagged rules; removes that rule's tags from the transcribed line.
- **Rules combine with OR**: a reference group on a line is transcribed when at least one rule selects that line. A group selected by several rules is transcribed once.
- **Tag removal on a transcribed line**: tags of every rule that selected this line and has `removeTagsAfter` on. Tags of rules that did not select the line are never removed. Untagged rules remove nothing.
- **Validation before anything happens** (the whole run is refused, nothing transcribed or edited):
  - no rules;
  - a folders rule with no non-blank folder;
  - a tagged rule with no non-blank tag;
  - a daily rule with a `fromDate` that is not a valid `YYYY-MM-DD`;
  - a daily rule while the Daily notes core plugin is off.
- Folder input is trimmed and normalized (`Inbox/` = `Inbox`). A folder that does not exist matches nothing and is not an error (the settings UI warns about it).

## Settings migration

None. The old keys (`transcribeTagged`, `folder`, `tags`, `removeTagsAfter`, `transcribeDailyNotes`, `dailyNotesFrom`) are dropped on load and the rule list starts empty. After the update, **Transcribe audio** refuses to run until the user adds rules. Whisper settings, pending deletions and remembered speeds are kept. (Max: a migration is an error risk, every user sets the rules up themselves.)

## Transcribe audio in current note

Unchanged: every audio in the open note, works with zero rules. Tags removed from its transcribed lines: tags of valid tagged rules with `removeTagsAfter` on **whose scope covers this note**; invalid rules are ignored and never block the command. *My call, after review: consistent with "a rule that did not select the note removes nothing".*

## Decisions added after the test-case review

- Validation runs before pending deletions are finished and before any note is read.
- Blank folder rows are ignored; folders are trimmed, slashes collapsed, leading/trailing slashes dropped; ` / ` is the whole vault. Folder names are case-sensitive and compared in NFC (macOS stores NFD).
- Dates are checked strictly: `2026-02-30`, `2026-2-1`, ` 2026-11-01 ` are refused. Empty means any date.
- A tag must consist of letters, digits, `_`, `-`, `/`; otherwise the rule is refused. Nested tags (`#transcribe/sub`) and longer tags do not match `transcribe` (safer than Obsidian's search, which counts nested tags as children).
- A stored rule of the wrong shape (unknown scope, missing or non-boolean `onlyTagged`, non-array folders or tags, non-string items) refuses the run; it is never filled in. A stored `rules` value that is not an array loads as no rules.
- Frontmatter, fenced code (also inside quotes; a closing fence carries no info string), inline code and comments (`%% %%`, `<!-- -->`, multi-line, unclosed to the end of the note) are hidden: references there are never transcribed or rewritten, a #word there or inside a link text is not a tag, and tag removal never touches them or the inserted transcript. Indented code blocks are not detected (they collide with nested lists).
- Tags are compared in NFC; a tag followed by a combining mark is a longer word. Digit-only tags are refused, as Obsidian does not treat them as tags.
- Daily notes: the path below the daily folder is parsed with the date format, so formats with slashes work and notes in subfolders do not count for flat formats.
- A task replaces exactly its own run of references: a lone `![[a]]` task never rewrites `a` inside `![[a]] ![[b]]` (fixes a 0.5.0 bug). A tag is removed from a line only once its last recording is transcribed (fixes a 0.5.0 bug with two recordings on one tagged line).
- The same audio twice side by side becomes one text. A tag between parts splits them into two recordings.
- Plain links count as references, as before.

## Settings UI

A card per rule, an OR divider between cards, **Add rule** at the bottom. Card: a plain-language summary under "Rule N" and a delete button; **Where** (Folders / Daily notes); for folders a row per folder with folder suggest and remove button plus **Add folder**; for daily notes **Dates** (Any date / From a date + date picker); **Which audio** (Every audio / Only with a tag on its line); for tagged rules **Tags** and **Remove tag after transcription**. Inline warnings: folder not found, tagged rule without tags, folders rule without folders, Daily notes plugin off. A new rule is Folders with one empty folder, tagged with `transcribe`, removal on.

## Test cases and expected results

Fixture vault for the job cases (each note has a tagged and an untagged reference, distinct audio per line):

| Note | Content |
|---|---|
| `Inbox/n.md` | `![[in-t.m4a]] #transcribe` / `![[in-u.m4a]]` / `![[in-v.m4a]] #voice` |
| `Inbox/Sub/deep.md` | `![[deep-t.m4a]] #transcribe` / `![[deep-u.m4a]]` |
| `Inbox2/n.md` | `![[in2-t.m4a]] #transcribe` / `![[in2-u.m4a]]` |
| `Projects/Voice/m.md` | `![[pv-t.m4a]] #transcribe` / `![[pv-u.m4a]]` |
| `Other/o.md` | `![[o-t.m4a]] #transcribe` / `![[o-u.m4a]]` / `![[o-v.m4a]] #voice` |
| `root.md` | `![[root-t.m4a]] #transcribe` / `![[root-u.m4a]]` |
| `Journal/Daily notes/2026-10-31.md` | `![[d31-t.m4a]] #transcribe` / `![[d31-u.m4a]]` |
| `Journal/Daily notes/2026-11-01.md` | `![[d01-t.m4a]] #transcribe` / `![[d01-u.m4a]]` |
| `Journal/Daily notes/2026-11-02.md` | `![[d02-t.m4a]] #transcribe` / `![[d02-u.m4a]]` |
| `Journal/Daily notes/Archive/2026-11-05.md` | `![[arch-u.m4a]]` (subfolder: not a daily note) |
| `Journal/Daily notes/Ideas.md` | `![[ideas-u.m4a]]` (not a date: not a daily note) |

Each case checks the exact set of transcribed audio (transcriber calls), and that every other note's content is byte-for-byte unchanged and every other audio is not trashed.

### Validation (whole run refused, transcriber never called, no note edited, nothing trashed)

| # | Rules | Expected |
|---|---|---|
| V1 | none | error mentions adding a rule |
| V2 | folders `[]` | error |
| V3 | folders `["", "  "]` | error |
| V4 | folders `Inbox`, tagged, tags `[]` | error |
| V5 | folders `Inbox`, tagged, tags `["", " "]` | error |
| V6 | daily from `2026-13-45` | error |
| V7 | daily from `01.11.2026` | error |
| V8 | daily, Daily notes plugin off | error |
| V9 | valid `/` untagged + invalid (V4) | error, nothing transcribed |

### Folder scope

| # | Rules | Transcribed |
|---|---|---|
| F1 | `Inbox`, every audio | in-t, in-u, in-v, deep-t, deep-u |
| F2 | `Inbox` + `Projects/Voice`, every audio | F1 + pv-t, pv-u |
| F3 | `/`, every audio | every audio in the vault (incl. daily, Archive, Ideas, root) |
| F4 | `Inbox`, tag `transcribe` | in-t, deep-t |
| F5 | `/`, tag `transcribe` | every `-t` audio |
| F6 | ` Inbox/ ` (spaces, trailing slash), every audio | same as F1 |
| F7 | `Inbox` | nothing from `Inbox2/` (prefix trap) |
| F8 | `Nope` (missing), every audio | nothing, no error |
| F9 | `/`, tag `transcribe`; extra note `Inbox/fm.md` with frontmatter `tags: [transcribe]` and untagged `![[fm.m4a]]` | fm not transcribed |
| F10 | `/`, tag `transcribe`; extra lines `![[x1.m4a]] #transcribe-later`, `![[x2.m4a]] #transcribe/sub`, `![[x3.m4a]] #Transcribe` | x3 only |
| F11 | `/`, tag `transcribe`; tag on the line above the audio, not on its line | not transcribed |

### Daily scope

| # | Rules | Transcribed |
|---|---|---|
| D1 | daily, any date, every audio | d31-*, d01-*, d02-*; not arch, not ideas |
| D2 | daily from `2026-11-01`, every audio | d01-*, d02-* (boundary inclusive), not d31 |
| D3 | daily from `2026-11-01`, tag `transcribe` | d01-t, d02-t |
| D4 | daily, any date, tag `transcribe` | d31-t, d01-t, d02-t |

### OR between rules

| # | Rules | Transcribed |
|---|---|---|
| O1 | daily from `2026-11-01` every audio OR `Inbox` tag `transcribe` | d01-*, d02-*, in-t, deep-t |
| O2 | `Inbox` tag `transcribe` OR `/` tag `voice` | in-t, deep-t, in-v, o-v (not o-t) |
| O3 | `Inbox` tag `transcribe` OR `/` tag `transcribe` | each `-t` once (one transcriber call per audio, one task per line) |
| O4 | `Inbox` tag `transcribe` OR `Inbox` every audio | every Inbox audio once |
| O5 | O1 rules in reverse order | same as O1 |
| O6 | daily every audio OR `Journal` every audio | daily notes, Archive and Ideas, each once |

### Tag removal

| # | Rules / line | Line after |
|---|---|---|
| R1 | `Inbox` tag `transcribe`, remove on; plus line `- idea #transcribe` without audio | transcribed line loses `#transcribe`; the idea line keeps it |
| R2 | same, remove off | `text #transcribe` |
| R3 | `/` tag `transcribe` remove on OR `/` tag `voice` remove off; line `![[a]] #transcribe #voice` | `text #voice` |
| R4 | `Inbox` every audio (untagged) only; line `![[in-t]] #transcribe` | `text #transcribe` (untagged rules remove nothing) |
| R5 | `Inbox` every audio OR `Other` tag `transcribe` remove on; line in Inbox `![[in-t]] #transcribe` | `text #transcribe` (rule 2 did not select this note) |
| R6 | `Inbox` every audio OR `Inbox` tag `transcribe` remove on | in-t line loses the tag; in-u, in-v lines just replaced |

### Settings storage

| # | Stored data | Expected after load |
|---|---|---|
| M1 | 0.5.0 data: `transcribeTagged`, `folder`, `tags`, `removeTagsAfter`, `transcribeDailyNotes: true`, `dailyNotesFrom`, whisper fields, pending deletions, speeds | `rules` is `[]`; no old keys in settings or in the next save; whisper fields, pending deletions, speeds unchanged |
| M2 | nothing (fresh install) | `rules` is `[]` |
| M3 | saved rules | loaded back equal |
| M4 | M1 data, then Transcribe audio | refused as V1 |

### Current note

| # | Case | Expected |
|---|---|---|
| S1 | no rules, current note with tagged and untagged audio | both transcribed |
| S2 | rules: `/` tag `transcribe` remove on, daily tag `voice` remove on, `Inbox` tag `x` remove off, `Inbox` every audio | tags to remove = `transcribe`, `voice` |

All cases above and those added after review (V10–V13, F6b–F6e, F12–F15, D5–D7, O7–O8, R7, A1–A8, S1–S5, M5–M6, DailyNotes formats, AudioLines unit cases) live in `tests/TranscriptionRules.test.ts`, `tests/AudioLines.test.ts`, `tests/DailyNotes.test.ts` and `tests/infrastructure.test.ts`.

Existing behaviour tests (replacement, failures, crash recovery, split recordings, single note) are kept and expressed with rules.

## Left to the builder

Class layout, error wording, UI details beyond the list above.
