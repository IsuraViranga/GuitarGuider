// Text shown and announced for a song note, kept in one place so the UI,
// screen-reader labels and (later) spoken guidance all say the same thing.

import { formatChordNumbers } from '../music/chords'
import { describePosition, formatGuitarNumber } from '../music/guitarNumber'
import { formatFrequency, midiToFrequency, midiToNoteName } from '../music/pitch'
import type { SongNote, SongScope } from './types'

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
  if (note.chord) {
    const positions = note.chord.tones.map((t) => t.position)
    return {
      number: formatChordNumbers(positions),
      position: `chord on ${positions.length} strings`,
      noteName: note.chord.name ?? 'chord',
      frequency: '',
    }
  }
  return {
    number: note.position ? formatGuitarNumber(note.position) : '?',
    position: note.position ? describePosition(note.position) : 'position not set',
    noteName: midiToNoteName(note.midi).label,
    frequency: formatFrequency(midiToFrequency(note.midi)),
  }
}

/** Short label for lists: the chord name for chords ("Am"), the number for single notes ("13"). */
export function shortLabel(note: SongNote): string {
  if (note.chord) return note.chord.name ?? describeNote(note).number
  return describeNote(note).number
}

/** e.g. "Note 5 of 12: 13, string 1, fret 3, G4" or "Note 2 of 8: C chord, [53 42 30 21 10]" */
export function noteAccessibleLabel(note: SongNote, total: number): string {
  const text = describeNote(note)
  if (note.chord) {
    return `Note ${note.index + 1} of ${total}: ${note.chord.name ? `${note.chord.name} chord` : 'chord'}, ${text.number}`
  }
  return `Note ${note.index + 1} of ${total}: ${text.number}, ${text.position}, ${text.noteName}`
}

const SCOPE_LABELS: Record<SongScope, { icon: string; text: string }> = {
  global: { icon: '🌍', text: 'Global' },
  mine: { icon: '🎸', text: 'My song' },
  device: { icon: '📱', text: 'On this phone' },
  draft: { icon: '📝', text: 'Not saved' },
}

/** Where a song lives, for badges: "🌍 Global", "🎸 My song", "📱 On this phone", "📝 Not saved". */
export function scopeLabel(scope: SongScope = 'global'): { icon: string; text: string } {
  return SCOPE_LABELS[scope]
}
