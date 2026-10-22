import type { GuitarPosition } from '../../music/guitarNumber'
import type { Difficulty, SongIssue } from '../types'

export type ParsedNote = { position: GuitarPosition; measure?: number }

export type ParsedSongFile = {
  title?: string
  description?: string
  difficulty?: Difficulty
  notes: ParsedNote[]
}

export type SongFileParseResult = { ok: true; value: ParsedSongFile } | { ok: false; issues: SongIssue[] }

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
