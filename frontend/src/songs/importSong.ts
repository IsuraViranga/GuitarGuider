// Turns an uploaded/pasted file into a song that is ready to save.
// File contents are untrusted: size is limited and everything is validated.

import { getTuning, STANDARD_TUNING } from '../music/tuning'
import { parseAsciiTab } from './parsers/asciiTab'
import { parseChordChart } from './parsers/chordChart'
import { parseGuitarNumberText } from './parsers/guitarNumberText'
import { parseHeaderLine } from './parsers/types'
import type { NewSong } from './songRepository'
import type { SongIssue } from './types'
import { notesFromPositions, validateSong } from './validation'

export type SongFileFormat = 'guitar-numbers' | 'ascii-tab' | 'chord-chart'

/** Plain-language names for the formats, shown to the user. */
export const FORMAT_LABELS: Record<SongFileFormat, string> = {
  'chord-chart': 'Chord chart (chord names above the words)',
  'ascii-tab': 'Guitar tab (6 lines like e|---0---|)',
  'guitar-numbers': "Instructor's numbers (like 10 11 [53 42 30 21 10])",
}

/**
 * Works out which format pasted text is in, so the user never has to choose:
 * tab lines → tab; only numbers/brackets/bars → instructor's numbers; anything else → chord chart.
 */
export function detectFormat(text: string): SongFileFormat {
  if (looksLikeAsciiTab(text)) return 'ascii-tab'
  const content = text.split(/\r?\n/).filter((line) => line.trim() && !/^\s*#/.test(line) && !parseHeaderLine(line))
  if (content.length > 0 && content.every((line) => /^[\s\d,|[\]]+$/.test(line))) return 'guitar-numbers'
  return 'chord-chart'
}

export const MAX_IMPORT_BYTES = 100 * 1024
export const MAX_TITLE_LENGTH = 120

export type ImportResult = { ok: true; song: NewSong } | { ok: false; issues: SongIssue[] }

export function importSongText(
  text: string,
  format: SongFileFormat | 'auto',
  titleOverride = '',
  tuningId = STANDARD_TUNING.id,
): ImportResult {
  const tuning = getTuning(tuningId)
  if (!tuning) return { ok: false, issues: [{ message: `Unknown tuning "${tuningId}".` }] }

  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return { ok: false, issues: [{ message: `The file is larger than ${MAX_IMPORT_BYTES / 1024} KB.` }] }
  }

  const chosen = format === 'auto' ? detectFormat(text) : format
  const parsed =
    chosen === 'ascii-tab'
      ? parseAsciiTab(text, tuning)
      : chosen === 'chord-chart'
        ? parseChordChart(text, tuning)
        : parseGuitarNumberText(text, tuning)
  if (!parsed.ok) return parsed

  const title = (titleOverride.trim() || parsed.value.title?.trim() || '').slice(0, MAX_TITLE_LENGTH)
  if (!title) {
    return { ok: false, issues: [{ message: 'Please give the song a title (or add a "title:" line to the file).' }] }
  }

  const song: NewSong = {
    title,
    tuningId: tuning.id,
    notes: notesFromPositions(parsed.value.notes, tuning),
    ...(parsed.value.difficulty ? { difficulty: parsed.value.difficulty } : {}),
    ...(parsed.value.description ? { description: parsed.value.description } : {}),
  }
  const issues = validateSong({ ...song, id: 'new', source: 'import' })
  return issues.length > 0 ? { ok: false, issues } : { ok: true, song }
}

/** A line like "e|---" means the text is ASCII tab rather than guitar numbers. */
export function looksLikeAsciiTab(text: string): boolean {
  return /^\s*[eEbBgGdDaA1-6]?\s*\|[-0-9|\s]*--/m.test(text)
}

/** Accept only small plain-text files. */
export function checkImportFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (!/\.(txt|tab|cho|chopro|chordpro|pro)$/i.test(file.name)) return 'Please choose a text file (.txt, .tab or ChordPro).'
  if (file.type && !file.type.startsWith('text/')) return 'That file is not a plain-text file.'
  if (file.size > MAX_IMPORT_BYTES) return `The file is larger than ${MAX_IMPORT_BYTES / 1024} KB.`
  return null
}

/** "Morning_Steps-v2.txt" → "Morning Steps v2" */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
}
