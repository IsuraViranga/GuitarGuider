import type { GuitarPosition } from '../music/guitarNumber'

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'

/** One string played as part of a chord. */
export type ChordTone = { midi: number; position: GuitarPosition }

export type Chord = {
  /** e.g. "Am", "C/G"; absent when the numbers are not a common chord */
  name?: string
  /** Strings played together, thickest string first. */
  tones: ChordTone[]
  /** Set when a chart's chord was simplified to a playable shape, e.g. "C9 is played as C7". */
  simplifiedFrom?: string
}

/** One step of a song: a single note, or a chord (several strings played together). */
export type SongNote = {
  /** 0-based order in the song */
  index: number
  /** Expected pitch as a MIDI note number (for a chord: its lowest note). */
  midi: number
  /** Intended string/fret (for a chord: its lowest string). null = position still to confirm. */
  position: GuitarPosition | null
  /** Present when this step is a chord. */
  chord?: Chord
  /** Words sung at this step (from an imported chord chart). */
  lyric?: string
  durationBeats?: number
  measure?: number
}

export type Song = {
  id: string
  title: string
  description?: string
  difficulty?: Difficulty
  tuningId: string
  /** sample = written for this app, library = instructor's file in src/songs/library, import = added in the browser */
  source: 'sample' | 'library' | 'import'
  notes: SongNote[]
}

/** Problem found in song data or an imported file. Line/column are 1-based. */
export type SongIssue = {
  message: string
  noteIndex?: number
  line?: number
  column?: number
}
