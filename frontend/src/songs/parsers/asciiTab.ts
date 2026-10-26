// Parser for simple ASCII guitar tab (single notes only).
//
//   title: Example
//   e|-----0---3---|
//   B|---1---------|
//   G|-------------|
//   D|-------------|
//   A|-------------|
//   E|-------------|
//
// Each block has 6 lines, thinnest string (1) at the top. Notes are read left to right;
// numbers are frets. Numbers on several strings in the same column are a chord (played together).
// See docs/song-formats.md.

import { identifyChord } from '../../music/chords'
import { STRING_NUMBERS, type StringNumber, type Tuning } from '../../music/tuning'
import type { SongIssue } from '../types'
import {
  numberLines,
  MAX_REPORTED_ISSUES,
  applyHeader,
  parseHeaderLine,
  type ParsedSongFile,
  type SongFileParseResult,
} from './types'

/** Accepted labels for each line of a block, top (string 1) to bottom (string 6). */
const STRING_LABELS: Record<StringNumber, readonly string[]> = {
  1: ['e', 'E', '1'],
  2: ['B', 'b', '2'],
  3: ['G', 'g', '3'],
  4: ['D', 'd', '4'],
  5: ['A', 'a', '5'],
  6: ['E', 'e', '6'],
}

const TECHNIQUE_NAMES: Record<string, string> = {
  h: 'hammer-on',
  p: 'pull-off',
  b: 'bend',
  r: 'release',
  s: 'slide',
  '/': 'slide',
  '\\': 'slide',
  '~': 'vibrato',
  x: 'muted note',
  X: 'muted note',
}

const TAB_LINE = /^\s*([A-Za-z0-9])?\s*\|/

type TabLine = { lineNumber: number; text: string }
type TabNote = { stringNumber: StringNumber; fret: number; offset: number; line: number; column: number }

export function parseAsciiTab(text: string, tuning: Tuning): SongFileParseResult {
  const result: ParsedSongFile = { notes: [] }
  const issues: SongIssue[] = []
  const blocks: TabLine[][] = []
  let current: TabLine[] = []

  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    const lineNumber = i + 1
    if (TAB_LINE.test(line)) {
      current.push({ lineNumber, text: line })
      return
    }
    if (current.length > 0) blocks.push(current)
    current = []

    const header = parseHeaderLine(line)
    if (header) {
      applyHeader(header, result, lineNumber, issues)
    } else if (/-{3,}/.test(line)) {
      issues.push({
        line: lineNumber,
        message: 'This looks like a tab line but has no "|" after the string name (for example "e|---0---").',
      })
    }
    // Any other line (lyrics, chord names, blank lines) is ignored.
  })
  if (current.length > 0) blocks.push(current)

  for (const block of blocks) {
    if (issues.length >= MAX_REPORTED_ISSUES) break
    if (block.length !== 6) {
      issues.push({
        line: block[0].lineNumber,
        message: `This tab block has ${block.length} string line(s). Each block needs exactly 6 lines, string 1 (thinnest, "e") at the top.`,
      })
      continue
    }
    // Group notes that start in the same column: those strings are played together (a chord).
    const notes = readBlock(block, tuning, issues)
    for (let k = 0; k < notes.length; ) {
      const column = notes.filter((n) => n.offset === notes[k].offset)
      const positions = column.map(({ stringNumber, fret }) => ({ stringNumber, fret }))
      // Each tab block is one line of the song.
      const line = block[0].lineNumber
      if (positions.length === 1) {
        result.notes.push({ position: positions[0], line })
      } else {
        const name = identifyChord(positions)
        result.notes.push({ position: positions[positions.length - 1], chord: { positions, ...(name ? { name } : {}) }, line })
      }
      k += column.length
    }
  }

  if (issues.length > 0) return { ok: false, issues: issues.slice(0, MAX_REPORTED_ISSUES) }
  if (result.notes.length === 0) {
    return { ok: false, issues: [{ message: 'No tab notes were found. Each tab line should look like "e|---0---3---|".' }] }
  }
  result.notes = numberLines(result.notes)
  return { ok: true, value: result }
}

function readBlock(block: TabLine[], tuning: Tuning, issues: SongIssue[]): TabNote[] {
  const notes: TabNote[] = []

  block.forEach(({ lineNumber, text }, i) => {
    const stringNumber = STRING_NUMBERS[i]
    const match = TAB_LINE.exec(text)!
    const label = match[1]
    if (label !== undefined && !STRING_LABELS[stringNumber].includes(label)) {
      issues.push({
        line: lineNumber,
        column: text.indexOf(label) + 1,
        message: `Line ${i + 1} of the block should be string ${stringNumber} ("${STRING_LABELS[stringNumber][0]}"), but it is labelled "${label}".`,
      })
      return
    }

    // Columns are measured from the first "|" so lines with different label widths still line up.
    const contentStart = match[0].length
    const content = text.slice(contentStart)
    let digits = ''
    let digitsStart = 0

    const flush = () => {
      if (!digits) return
      const fret = Number(digits)
      const column = contentStart + digitsStart + 1
      if (fret > tuning.maxFret) {
        issues.push({ line: lineNumber, column, message: `Fret ${fret} is above the highest fret (${tuning.maxFret}).` })
      } else {
        notes.push({ stringNumber, fret, offset: digitsStart, line: lineNumber, column })
      }
      digits = ''
    }

    for (let j = 0; j < content.length; j++) {
      const char = content[j]
      if (char >= '0' && char <= '9') {
        if (!digits) digitsStart = j
        digits += char
      } else if (char === '-' || char === '|' || char === ' ' || char === '\t') {
        flush()
      } else {
        flush()
        const name = TECHNIQUE_NAMES[char]
        issues.push({
          line: lineNumber,
          column: contentStart + j + 1,
          message: `Unsupported symbol "${char}"${name ? ` (${name})` : ''}. Only fret numbers, "-" and "|" are supported.`,
        })
        return
      }
    }
    flush()
  })

  // Order left to right (and thickest string first within a column).
  notes.sort((a, b) => a.offset - b.offset || b.stringNumber - a.stringNumber)
  return notes
}
