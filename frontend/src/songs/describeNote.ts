// Text shown and announced for a song note, kept in one place so the UI,
// screen-reader labels and (later) spoken guidance all say the same thing.

import { describePosition, formatGuitarNumber } from '../music/guitarNumber'
import { formatFrequency, midiToFrequency, midiToNoteName } from '../music/pitch'
import type { Song, SongNote } from './types'

export type NoteText = {
  /** Instructor number, e.g. "13", or "?" when the position is unknown */
  number: string
  /** e.g. "string 1, fret 3" */
  position: string
  /** e.g. "G4" */
  noteName: string
  /** e.g. "392.00 Hz" */
  frequency: string
}

export function describeNote(note: SongNote): NoteText {
  return {
    number: note.position ? formatGuitarNumber(note.position) : '?',
    position: note.position ? describePosition(note.position) : 'position not set',
    noteName: midiToNoteName(note.midi).label,
    frequency: formatFrequency(midiToFrequency(note.midi)),
  }
}

/** e.g. "Note 5 of 12: 13, string 1, fret 3, G4" */
export function noteAccessibleLabel(note: SongNote, total: number): string {
  const text = describeNote(note)
  return `Note ${note.index + 1} of ${total}: ${text.number}, ${text.position}, ${text.noteName}`
}

const SOURCE_LABELS: Record<Song['source'], string> = {
  library: 'Instructor library',
  sample: 'Sample',
  import: 'Imported',
}

export function songSourceLabel(source: Song['source']): string {
  return SOURCE_LABELS[source]
}
