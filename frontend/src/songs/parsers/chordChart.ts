// Parser for chord charts, the format most song websites use (including Sinhala song sites):
//
//   Intro: C  G  Am  F
//
//   C              G
//   Malata bambareku se
//   Am             F
//   sithata oba enawa
//
// and ChordPro, used by songbook apps:  [C]Malata bambareku [G]se
//
// Each chord becomes a chord step, converted to the instructor's numbers with standard guitar
// shapes (see music/chords.ts). The words sung at each chord are kept, so the practice screen can
// show them. Section labels ("Chorus", "[Verse 1]"), repeat marks ("x2"), bar lines and "N.C." are
// understood and skipped.

import { chordShape, isChordName } from '../../music/chords'
import type { Tuning } from '../../music/tuning'
import type { SongIssue } from '../types'
import { MAX_REPORTED_ISSUES, applyHeader, numberLines, parseHeaderLine, type ParsedNote, type ParsedSongFile, type SongFileParseResult } from './types'

/** A section label at the start of a line: "[Verse 1]", "(Chorus)" or "Intro:" (only the label itself). */
const SECTION_LABEL =
  /^\s*(?:\[[^\]]*\]|\((?:intro|verse|chorus|bridge|outro|pre-?chorus|interlude|solo|instrumental|ending|coda|hook|refrain|tag|music)[^)]*\)|(?:intro|verse|chorus|bridge|outro|pre-?chorus|interlude|solo|instrumental|ending|coda|hook|refrain|tag|music)(?:\s*\d+)?\s*:)/i
const SKIPPED_TOKEN = /^(\|+|-+|\/+|x\d+|\d+x|\.{2,}|N\.?C\.?|%|\(|\))$/i
const CHORDPRO_DIRECTIVE = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i
const CHORDPRO_CHORD = /\[([^\]]+)\]/g

type ChordAt = { name: string; column: number }

/** The chords on a "chord line" (only chord names, labels and bar marks), or null if it is not one. */
function chordLine(line: string): ChordAt[] | null {
  const label = SECTION_LABEL.exec(line)
  const start = label ? label[0].length : 0
  const chords: ChordAt[] = []
  for (const match of line.slice(start).matchAll(/\S+/g)) {
    const token = match[0].replace(/^\(+|\)+$/g, '')
    if (token === '' || SKIPPED_TOKEN.test(token)) continue
    if (!isChordName(token)) return null
    chords.push({ name: token, column: start + (match.index ?? 0) })
  }
  return chords.length > 0 ? chords : null
}

/** "[C]Malata [G]bambareku" → chords with the words that follow each. Null if not ChordPro. */
function chordProLine(line: string): Array<{ name: string; lyric: string }> | null {
  const matches = [...line.matchAll(CHORDPRO_CHORD)].filter((m) => isChordName(m[1].trim()))
  if (matches.length === 0) return null
  return matches.map((m, i) => {
    const from = (m.index ?? 0) + m[0].length
    const to = i + 1 < matches.length ? matches[i + 1].index : line.length
    const lyric = line.slice(from, to).replace(CHORDPRO_CHORD, '').trim()
    return { name: m[1].trim(), lyric }
  })
}

/** Words to sing: not chords, labels ("[Chorus]", "Intro:"), separators ("-----") or settings. */
function isLyricLine(line: string | undefined): line is string {
  if (line === undefined || line.trim() === '') return false
  if (chordLine(line) || chordProLine(line) || CHORDPRO_DIRECTIVE.test(line) || parseHeaderLine(line)) return false
  if (/^[\s\-=_*|~.]+$/.test(line)) return false // separator line
  const label = SECTION_LABEL.exec(line)
  if (label && line.slice(label[0].length).trim() === '') return false // a section name on its own
  return true
}

export function parseChordChart(text: string, _tuning: Tuning): SongFileParseResult {
  const result: ParsedSongFile = { notes: [] }
  const issues: SongIssue[] = []
  // Ultimate-Guitar style markup ([ch]Am[/ch], [tab]...[/tab]) is reduced to plain text first.
  const lines = text
    .replace(/\[\/?(ch|tab)\]/gi, '')
    .replace(/\t/g, '    ')
    .split(/\r?\n/)

  const addChord = (name: string, lyric: string, line: number, column: number) => {
    const shape = chordShape(name)
    if (!shape.ok) {
      issues.push({ line, column, message: shape.error })
      return
    }
    const { positions, simplifiedFrom } = shape.value
    const step: ParsedNote = {
      position: positions[0],
      chord: { name, positions, ...(simplifiedFrom ? { simplifiedFrom } : {}) },
      ...(lyric ? { lyric } : {}),
      line,
    }
    result.notes.push(step)
  }

  for (let i = 0; i < lines.length && issues.length < MAX_REPORTED_ISSUES; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const directive = CHORDPRO_DIRECTIVE.exec(line)
    if (directive) {
      const key = directive[1].toLowerCase()
      if ((key === 'title' || key === 't') && directive[2]) result.title = directive[2]
      if ((key === 'subtitle' || key === 'st' || key === 'artist') && directive[2] && !result.description) result.description = directive[2]
      continue
    }
    const header = parseHeaderLine(line)
    if (header) {
      applyHeader(header, result, i + 1, issues)
      continue
    }

    const inline = chordProLine(line)
    if (inline) {
      const column = line.indexOf('[') + 1
      for (const { name, lyric } of inline) addChord(name, lyric, i + 1, column)
      continue
    }

    const chords = chordLine(line)
    if (!chords) continue // lyrics without chords, comments, section names: nothing to play

    // The next line holds the words sung under these chords, if it is a lyric line. Text copied
    // from a web page sometimes has one blank line in between, so that is skipped.
    const gap = lines[i + 1]?.trim() === '' && isLyricLine(lines[i + 2]) ? 1 : 0
    const next = lines[i + 1 + gap]
    const hasLyrics = isLyricLine(next)
    // Where a chord's column falls in the words. For Latin text the columns line up letter by
    // letter. Other scripts (e.g. Sinhala) combine characters and display wider, so the columns
    // do not line up; there the chord is placed at the same fraction of the line instead.
    const chordLineWidth = chords[chords.length - 1].column + chords[chords.length - 1].name.length
    const lyricOffset = (column: number) => {
      const latinOnly = [...next].every((ch) => ch.codePointAt(0)! <= 0x24f)
      if (latinOnly) return column
      const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(next)]
      const index = Math.round((column / Math.max(chordLineWidth, 1)) * graphemes.length)
      return graphemes[index]?.index ?? next.length
    }
    // A chord written above the middle of a word starts at that word, so words are never cut.
    const wordStart = (column: number) => {
      let c = Math.min(lyricOffset(column), next?.length ?? 0)
      while (c > 0 && /\S/.test(next[c - 1]) && /\S/.test(next[c] ?? ' ')) c--
      return c
    }
    chords.forEach((chord, k) => {
      let lyric = ''
      if (hasLyrics) {
        const from = k === 0 ? 0 : wordStart(chord.column)
        const to = k + 1 < chords.length ? wordStart(chords[k + 1].column) : next.length
        lyric = next.slice(from, to).trim()
      }
      addChord(chord.name, lyric, i + 1, chord.column + 1)
    })
    if (hasLyrics) i += 1 + gap
  }

  if (issues.length > 0) return { ok: false, issues: issues.slice(0, MAX_REPORTED_ISSUES) }
  result.notes = numberLines(result.notes)
  if (result.notes.length === 0) {
    return {
      ok: false,
      issues: [
        {
          message:
            'No chords were found. Paste a chord chart: chord names (like C  G  Am) on their own line above the words, or ChordPro like "[C]words".',
        },
      ],
    }
  }
  return { ok: true, value: result }
}
