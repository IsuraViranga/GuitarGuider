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
  /** Which line of the sheet this step was written on (1, 2, …); absent for one-line songs. */
  line?: number
}

/**
 * Where a song lives: global = the set list for everyone (only the admin changes it), mine = the
 * signed-in user's own song (on the server), device = saved on this phone before accounts
 * existed, draft = checked on the Add a song page but not saved (practise without saving).
 */
export type SongScope = 'global' | 'mine' | 'device' | 'draft'

export type ShareStatus = 'pending' | 'approved' | 'rejected'

export type Song = {
  id: string
  title: string
  artist?: string
  description?: string
  difficulty?: Difficulty
  tuningId: string
  /** Built into the app: sample = written for this app, library = instructor's file in src/songs/library, import = added in the browser */
  source?: 'sample' | 'library' | 'import'
  scope?: SongScope
  /** True when the signed-in user may change or delete this song. */
  canEdit?: boolean
  /** The text the song was made from, so it can be edited. */
  sourceText?: string
  /** Own songs: the latest request to share it with everyone (and the admin's reason if not accepted). */
  shareStatus?: ShareStatus
  shareReason?: string
  notes: SongNote[]
}

/** Problem found in song data or an imported file. Line/column are 1-based. */
export type SongIssue = {
  message: string
  noteIndex?: number
  line?: number
  column?: number
}
