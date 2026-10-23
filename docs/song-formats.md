# Song file formats

**Easiest way:** copy a song from any website and paste it on the **Add a song** page. The app
recognises the format by itself (chord chart, tab, or instructor's numbers), converts it to guitar
numbers, and shows a preview before saving.

## 0. Chord charts (most song websites)

Chord names on their own line above the words:

```
Intro: C  G  Am  F

[Verse 1]
C              G
Words of the song here
Am             F
More words here
```

- Each chord becomes a chord step using standard guitar shapes, e.g. C = `[53 42 30 21 10]`,
  G = `[63 52 40 30 20 13]`, Am = `[50 42 32 21 10]`. Uncommon chords use movable barre shapes.
- Rich chords (C9, Cm6, …) are simplified to the closest common shape, and the preview says so.
- The words under each chord are kept and shown while practising (Sinhala included). Words are never
  cut in half; for Sinhala the chord is placed proportionally along the line.
- Section labels (`[Chorus]`, `Intro:`), repeat marks (`x2`), bar lines and `N.C.` are skipped.
- **ChordPro** (`[C]words [G]more words`, `{title: …}`) and Ultimate-Guitar style `[ch]Am[/ch]`
  markup are understood too.


Only the formats below are supported. Files must be plain text (`.txt` or `.tab`), at most 100 KB.
Songs can mix single notes and chords.

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

**Chords** in square brackets: the strings played together, e.g. `[53 42 30 21 10]` = C.

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
- Numbers on several strings in the same column are a chord (strummed together).
- Several blocks are read one after another. Lines that are not tab lines (lyrics, chord names, blank lines) are ignored.

## Not supported yet

- MIDI and MusicXML: planned for Phase 5, on the server. These files contain pitches but not always
  string/fret positions, so a "confirm positions" step will be added with them.
- Audio recordings (MP3, WAV, …): converting a recording into notes is a different, much harder problem
  and is out of scope.
