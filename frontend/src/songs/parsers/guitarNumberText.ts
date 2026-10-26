// Parser for the instructor's own notation: a list of guitar numbers.
//
//   title: Morning Steps
//   description: Arranged by ...
//   difficulty: beginner
//   # lines starting with # are comments
//   21 23 10 11 | 13 11 10 23 | [53 42 30 21 10]
//
// Numbers are separated by spaces or commas. "|" starts a new measure (optional).
// Numbers in square brackets are a chord: strings played together, e.g. [53 42 30 21 10] = C.
// See docs/song-formats.md.

import { identifyChord, parseChordNumbers } from '../../music/chords'
import { parseGuitarNumber } from '../../music/guitarNumber'
import type { Tuning } from '../../music/tuning'
import type { SongIssue } from '../types'
import {
  MAX_REPORTED_ISSUES,
  applyHeader,
  numberLines,
  parseHeaderLine,
  type ParsedSongFile,
  type ParsedNote,
  type SongFileParseResult,
} from './types'

export function parseGuitarNumberText(text: string, tuning: Tuning): SongFileParseResult {
  const result: ParsedSongFile = { notes: [] }
  const issues: SongIssue[] = []
  let measure = 1
  let sawBarline = false
  const notes: Array<ParsedNote & { measure: number }> = []

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length && issues.length < MAX_REPORTED_ISSUES; i++) {
    const lineNumber = i + 1
    const line = lines[i]
    if (/^\s*(#|$)/.test(line)) continue

    const header = parseHeaderLine(line)
    if (header) {
      applyHeader(header, result, lineNumber, issues)
      continue
    }

    // Split into tokens, remembering each token's column for error messages.
    for (const match of line.matchAll(/\[[^\]]*\]?|\||[^\s,|[\]]+/g)) {
      const token = match[0]
      const column = (match.index ?? 0) + 1
      if (token === '|') {
        // A barline only starts a new measure if notes came before it.
        if (notes.length > 0 && notes[notes.length - 1].measure === measure) measure++
        sawBarline = true
        continue
      }
      if (token.startsWith('[')) {
        const chord = token.endsWith(']') ? parseChordNumbers(token, tuning.maxFret) : ({ ok: false, error: `The chord ${token} has no closing "]".` } as const)
        if (chord.ok) {
          const name = identifyChord(chord.value)
          notes.push({ position: chord.value[0], chord: { positions: chord.value, ...(name ? { name } : {}) }, measure, line: lineNumber })
        } else {
          issues.push({ line: lineNumber, column, message: chord.error })
          if (issues.length >= MAX_REPORTED_ISSUES) break
        }
        continue
      }
      const parsed = parseGuitarNumber(token, tuning.maxFret)
      if (parsed.ok) {
        notes.push({ position: parsed.value, measure, line: lineNumber })
      } else {
        issues.push({ line: lineNumber, column, message: parsed.error })
        if (issues.length >= MAX_REPORTED_ISSUES) break
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  if (notes.length === 0) return { ok: false, issues: [{ message: 'No guitar numbers were found in the file.' }] }

  // Measures are only meaningful if the file actually used barlines.
  result.notes = numberLines(sawBarline ? notes : notes.map(({ measure: _measure, ...note }) => note))
  return { ok: true, value: result }
}
