import type { GuitarPosition } from '../music/guitarNumber'

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'

export type SongNote = {
  /** 0-based order in the song */
  index: number
  /** Expected pitch as a MIDI note number. This is what playing is compared against. */
  midi: number
  /** Intended string/fret. null means an import still needs the position confirmed. */
  position: GuitarPosition | null
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
