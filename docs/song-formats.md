# Song file formats

Only the formats below are supported. Files must be plain text (`.txt` or `.tab`), at most 100 KB.
Single notes only: chords are rejected with an explanation.

Both formats may contain optional header lines:

```
title: My Song
description: Arranged by ...   # optional, shown in the song list
difficulty: beginner           # beginner | intermediate | advanced
```

Files placed in `frontend/src/songs/library/` become built-in songs (see the README in that folder).

A title typed on the Import page takes priority over the `title:` line.

**Sinhala and other languages:** titles can be in any language, e.g. `title: මගේ පළමු ගීතය`.
Save files as **UTF-8** (recommended) or UTF-16 ("Unicode" in old Notepad). Text typed with old
non-Unicode Sinhala fonts (such as "FM" fonts) shows as Latin letters and cannot be converted;
use a Unicode Sinhala keyboard instead.

---

## 1. Guitar numbers (the instructor's notation)

Each note is a number: **first digit = string (1–6), remaining digits = fret (0–24)**.

| Number | Meaning |
|---|---|
| `10` | string 1, open |
| `13` | string 1, fret 3 |
| `112` | string 1, fret 12 |
| `60` | string 6, open |

Rules:
- Separate numbers with spaces, commas or new lines.
- `|` marks the start of a new measure (optional).
- Lines starting with `#` are comments.
- Frets have no leading zero (`105` is rejected; write `15`).

Example:

```
title: Morning Steps
difficulty: beginner
21 23 10 11 | 13 11 10 23
21 23 20 21
```

## 2. ASCII tab

Blocks of exactly **6 lines**, string 1 (thinnest, `e`) at the top and string 6 (thickest, `E`) at the bottom.
Each line starts with an optional label, then `|`.

```
title: Example
e|-----0---3---|
B|---1---------|
G|-------------|
D|-------------|
A|-------------|
E|-0-----------|
```

This reads as `60 21 10 13`.

Rules:
- Accepted labels per line: `e/E/1`, `B/b/2`, `G/g/3`, `D/d/4`, `A/a/5`, `E/e/6`, or none.
- Notes are read left to right. Columns are counted from the first `|` on each line.
- Several digits in a row form one fret (`12` = fret 12).
- Allowed characters after the `|`: digits, `-`, `|` and spaces.
- Playing techniques (`h`, `p`, `b`, `/`, `\`, `~`, `x`, …) are rejected with a message naming the technique.
- Two strings in the same column are a chord and are rejected.
- Several blocks are read one after another. Lines that are not tab lines (lyrics, chord names, blank lines) are ignored.

## Not supported yet

- MIDI and MusicXML: planned for Phase 5, on the server. These files contain pitches but not always
  string/fret positions, so a "confirm positions" step will be added with them.
- Audio recordings (MP3, WAV, …): converting a recording into notes is a different, much harder problem
  and is out of scope.
