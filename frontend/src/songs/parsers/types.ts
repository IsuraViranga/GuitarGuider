import type { GuitarPosition } from '../../music/guitarNumber'
import type { Difficulty, SongIssue } from '../types'

/** A parsed step: one position, or a chord (several positions); lyric from chord charts. */
export type ParsedNote = {
  position: GuitarPosition
  chord?: { name?: string; positions: GuitarPosition[]; simplifiedFrom?: string }
  lyric?: string
  measure?: number
  /** Which line of the sheet the step was written on (1, 2, …); only set when there are several lines. */
  line?: number
}

export type ParsedSongFile = {
  title?: string
  description?: string
  difficulty?: Difficulty
  notes: ParsedNote[]
  /** Things the user should check in the preview; they do not stop the import. */
  warnings?: SongIssue[]
}

export type SongFileParseResult = { ok: true; value: ParsedSongFile } | { ok: false; issues: SongIssue[] }

/**
 * Numbers the lines that have notes 1, 2, 3… in order (source lines without notes leave no gap).
 * A song written on one line gets no line numbers at all, so it stays exactly as before.
 */
export function numberLines<T extends { line?: number }>(notes: T[]): T[] {
  const order = [...new Set(notes.map((n) => n.line).filter((l): l is number => l !== undefined))]
  if (order.length <= 1) return notes.map(({ line: _line, ...rest }) => rest as T)
  const index = new Map(order.map((line, i) => [line, i + 1]))
  return notes.map((n) => (n.line === undefined ? n : { ...n, line: index.get(n.line)! }))
}

/** Stop collecting after this many problems so a wrong file doesn't produce thousands of messages. */
export const MAX_REPORTED_ISSUES = 20

const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'intermediate', 'advanced']

type HeaderLine =
  | { key: 'title' | 'description'; value: string }
  | { key: 'difficulty'; value: Difficulty | null }

/**
 * Reads an optional "title: ...", "description: ..." or "difficulty: ..." header line.
 * Returns undefined if the line is not a header.
 */
export function parseHeaderLine(line: string): HeaderLine | undefined {
  const match = /^\s*(title|description|difficulty)\s*:\s*(.*)$/i.exec(line)
  if (!match) return undefined
  const key = match[1].toLowerCase()
  const value = match[2].trim()
  if (key === 'title' || key === 'description') return { key, value }
  const difficulty = value.toLowerCase() as Difficulty
  return { key: 'difficulty', value: DIFFICULTIES.includes(difficulty) ? difficulty : null }
}

/** Applies a header line to the parsed file, recording an issue for a bad difficulty. */
export function applyHeader(header: HeaderLine, result: ParsedSongFile, lineNumber: number, issues: SongIssue[]) {
  if (header.key === 'difficulty') {
    if (header.value === null) issues.push(difficultyError(lineNumber))
    else result.difficulty = header.value
  } else {
    result[header.key] = header.value || undefined
  }
}

export function difficultyError(line: number): SongIssue {
  return { line, message: `Difficulty must be one of: ${DIFFICULTIES.join(', ')}.` }
}
