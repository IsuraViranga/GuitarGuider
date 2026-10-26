// Showing a song in the lines it was written in (the sheet's line breaks).
// Songs saved before line numbers existed fall back to their measures, as they were shown before.

import type { SongNote } from './types'

/** Which group a step belongs to when shown: its sheet line, or (older songs) its measure. */
export function groupKey(note: SongNote): number | undefined {
  return note.line ?? note.measure
}

/** True when the song has sheet lines to show ("Line 1", "Line 2", …). */
export function hasLines(notes: readonly SongNote[]): boolean {
  return notes.some((note) => note.line !== undefined)
}

/** True when `note` starts a new sheet line (compared with the step shown before it). */
export function startsLine(note: SongNote, previous: SongNote | undefined): boolean {
  return note.line !== undefined && note.line !== previous?.line
}
