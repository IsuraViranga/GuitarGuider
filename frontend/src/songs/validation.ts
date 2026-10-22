import { positionToMidi, validatePosition } from '../music/fretboard'
import { formatGuitarNumber, type GuitarPosition } from '../music/guitarNumber'
import { midiToNoteName } from '../music/pitch'
import { getTuning, type Tuning } from '../music/tuning'
import type { Song, SongIssue, SongNote } from './types'

export const MAX_NOTES_PER_SONG = 2000

/** Builds song notes from intended positions; the pitch is derived from the tuning. */
export function notesFromPositions(
  items: ReadonlyArray<{ position: GuitarPosition; measure?: number }>,
  tuning: Tuning,
): SongNote[] {
  return items.map(({ position, measure }, index) => ({
    index,
    midi: positionToMidi(position, tuning),
    position,
    ...(measure === undefined ? {} : { measure }),
  }))
}

/** Checks a song is ready to practise. An empty list means it is valid. */
export function validateSong(song: Song): SongIssue[] {
  const issues: SongIssue[] = []
  if (!song.title.trim()) issues.push({ message: 'The song needs a title.' })

  const tuning = getTuning(song.tuningId)
  if (!tuning) {
    issues.push({ message: `Unknown tuning "${song.tuningId}".` })
    return issues
  }

  if (song.notes.length === 0) issues.push({ message: 'The song has no notes.' })
  if (song.notes.length > MAX_NOTES_PER_SONG) {
    issues.push({ message: `The song has ${song.notes.length} notes; the limit is ${MAX_NOTES_PER_SONG}.` })
  }

  song.notes.forEach((note, i) => {
    const label = `Note ${i + 1}`
    if (note.index !== i) {
      issues.push({ noteIndex: i, message: `${label} has index ${note.index}; expected ${i}.` })
    }
    if (!Number.isInteger(note.midi)) {
      issues.push({ noteIndex: i, message: `${label} has an invalid pitch (${note.midi}).` })
      return
    }
    if (note.position === null) {
      issues.push({ noteIndex: i, message: `${label} (${midiToNoteName(note.midi).label}) has no string/fret yet.` })
      return
    }
    const positionError = validatePosition(note.position, tuning)
    if (positionError) {
      issues.push({ noteIndex: i, message: `${label}: ${positionError}` })
      return
    }
    const positionMidi = positionToMidi(note.position, tuning)
    if (positionMidi !== note.midi) {
      issues.push({
        noteIndex: i,
        message: `${label}: ${formatGuitarNumber(note.position)} plays ${midiToNoteName(positionMidi).label}, but the song expects ${midiToNoteName(note.midi).label}.`,
      })
    }
  })

  return issues
}
