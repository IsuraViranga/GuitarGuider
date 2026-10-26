// Parser for the instructor's song sheets: a line of guitar numbers with the words underneath.
//
//   Twinkle, twinkle
//
//   23      23    15     15    17   17   15
//   Twin  kle,  twin  kle,  lit    tle   star,
//
// Each word (or syllable) belongs to the number in the same place in the line above: the 1st word
// to the 1st number, the 2nd to the 2nd, and so on. Counting is used, not columns, because sheets
// are typed in proportional fonts where columns do not line up exactly.
//
// - The numbers line is read exactly like the instructor's numbers (chords in brackets, "|").
// - If a words line has a different number of words, "twin-kle" style syllables are tried; if it
//   still does not match, the whole line is kept with the first note and a warning names the line.
//   Nothing is guessed.
// - The title is the last text line before the first numbers line (school names in a header above
//   it are skipped), unless the text has a "title:" line.
// - A text line that looks like mistyped numbers ("2O" with a letter O) is an error, so a note can
//   never be lost by being taken for words.
// See docs/song-formats.md.

import type { Tuning } from '../../music/tuning'
import type { SongIssue } from '../types'
import { damagedSinhalaWords } from '../text'
import { parseGuitarNumberText } from './guitarNumberText'
import {
  MAX_REPORTED_ISSUES,
  applyHeader,
  numberLines,
  parseHeaderLine,
  type ParsedNote,
  type ParsedSongFile,
  type SongFileParseResult,
} from './types'

/** Only guitar numbers, chords in brackets, commas and barlines, with at least one digit. */
export function isNumbersLine(line: string): boolean {
  return /\d/.test(line) && /^[\s\d,|[\]]+$/.test(line)
}

function isBlankOrComment(line: string): boolean {
  return /^\s*(#|$)/.test(line)
}

/** A text line that is probably a mistyped numbers line: mostly numbers, or tokens like "2O" / "l3". */
function looksLikeMistypedNumbers(line: string): string | null {
  const tokens = line.trim().split(/\s+/)
  const mixed = tokens.find((t) => /\d/.test(t) && /[A-Za-z]/.test(t))
  if (mixed) return mixed
  const numeric = tokens.filter((t) => /^\d+$/.test(t)).length
  return numeric * 2 > tokens.length ? tokens.find((t) => !/^\d+$/.test(t)) ?? null : null
}

/** The words of a line, one per note if possible ("twin-kle" counts as two). */
function wordsFor(line: string, count: number): string[] | null {
  const words = line.trim().split(/\s+/).filter(Boolean)
  if (words.length === count) return words
  const syllables = line
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
  return syllables.length === count ? syllables : null
}

export function parseSongSheet(text: string, tuning: Tuning): SongFileParseResult {
  const result: ParsedSongFile = { notes: [] }
  const issues: SongIssue[] = []
  const warnings: SongIssue[] = []
  const notes: ParsedNote[] = []
  let titleCandidate: string | undefined
  let measure = 0

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length && issues.length < MAX_REPORTED_ISSUES; i++) {
    const lineNumber = i + 1
    const line = lines[i]
    if (isBlankOrComment(line)) continue
    const header = parseHeaderLine(line)
    if (header) {
      applyHeader(header, result, lineNumber, issues)
      continue
    }

    if (!isNumbersLine(line)) {
      const suspicious = looksLikeMistypedNumbers(line)
      if (suspicious) {
        issues.push({ line: lineNumber, message: `"${suspicious}" is not a guitar number. Please check this line.` })
      } else if (notes.length === 0) {
        // Text before the first numbers: a title or a school name. The last one is the title.
        titleCandidate = line.trim().replace(/\s+/g, ' ')
      }
      // Other text (not right under numbers) is a section label like "Chorus": not played.
      continue
    }

    // A numbers line: read it exactly like the instructor's numbers.
    const parsed = parseGuitarNumberText(line, tuning)
    if (!parsed.ok) {
      for (const issue of parsed.issues) issues.push({ ...issue, line: lineNumber })
      continue
    }
    measure++
    // Each sheet line is one measure and one line (a "|" inside a sheet line does not split it).
    const lineNotes = parsed.value.notes.map((note) => ({ ...note, measure, line: measure }))

    // The words line, if there is one directly underneath.
    const next = lines[i + 1]
    if (next !== undefined && !isBlankOrComment(next) && !parseHeaderLine(next) && !isNumbersLine(next) && !looksLikeMistypedNumbers(next)) {
      i++
      const damaged = damagedSinhalaWords(next)
      if (damaged.length > 0) {
        warnings.push({
          line: i + 1,
          message: `Some Sinhala words look damaged: ${damaged.join('  ·  ')}. The notes are correct; please correct these words, or use the Word (.docx) file.`,
        })
      }
      const words = wordsFor(next, lineNotes.length)
      if (words) {
        lineNotes.forEach((note, k) => (note.lyric = words[k]))
      } else {
        const wordsLine = next.trim().replace(/\s+/g, ' ')
        const count = wordsLine.split(' ').length
        warnings.push({
          line: i + 1,
          message: `“${wordsLine}”: ${lineNotes.length} numbers but ${count} words, so the words could not be matched one by one. The whole line is shown with the first note.`,
        })
        lineNotes[0].lyric = wordsLine
      }
    }
    notes.push(...lineNotes)
  }

  if (issues.length > 0) return { ok: false, issues }
  if (notes.length === 0) return { ok: false, issues: [{ message: 'No guitar numbers were found in the file.' }] }
  result.title ??= titleCandidate
  result.notes = numberLines(notes)
  if (warnings.length > 0) result.warnings = warnings
  return { ok: true, value: result }
}
