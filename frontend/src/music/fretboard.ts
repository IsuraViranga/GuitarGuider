// Mapping between guitar positions and pitches for a given tuning.
// Each fret raises the open-string pitch by one semitone.

import type { GuitarPosition } from './guitarNumber'
import { STANDARD_TUNING, STRING_NUMBERS, isStringNumber, type Tuning } from './tuning'

/** Returns an error message, or null when the position exists on this guitar. */
export function validatePosition(position: GuitarPosition, tuning: Tuning = STANDARD_TUNING): string | null {
  if (!isStringNumber(position.stringNumber)) {
    return `String ${position.stringNumber} does not exist. Strings are numbered 1 to 6.`
  }
  if (!Number.isInteger(position.fret) || position.fret < 0) {
    return `Fret ${position.fret} is not valid. Frets are whole numbers from 0 (open string).`
  }
  if (position.fret > tuning.maxFret) {
    return `Fret ${position.fret} is above the highest fret (${tuning.maxFret}).`
  }
  return null
}

export function isValidPosition(position: GuitarPosition, tuning: Tuning = STANDARD_TUNING): boolean {
  return validatePosition(position, tuning) === null
}

export function positionToMidi(position: GuitarPosition, tuning: Tuning = STANDARD_TUNING): number {
  const error = validatePosition(position, tuning)
  if (error) throw new RangeError(error)
  return tuning.openStringMidi[position.stringNumber] + position.fret
}

/** Every place on the fretboard where this pitch can be played, ordered from string 1 to 6. */
export function positionsForMidi(midi: number, tuning: Tuning = STANDARD_TUNING): GuitarPosition[] {
  return STRING_NUMBERS.flatMap((stringNumber) => {
    const fret = midi - tuning.openStringMidi[stringNumber]
    return Number.isInteger(fret) && fret >= 0 && fret <= tuning.maxFret ? [{ stringNumber, fret }] : []
  })
}

/**
 * Other places where exactly the same note can be played (same pitch, other strings), lowest fret
 * first, up to `maxFret`. The app hears pitch only, so it cannot tell these apart: 10 and 25 are
 * both E4.
 */
export function samePitchPositions(position: GuitarPosition, tuning: Tuning = STANDARD_TUNING, maxFret = 12): GuitarPosition[] {
  const midi = positionToMidi(position, tuning)
  return positionsForMidi(midi, tuning)
    .filter((p) => p.stringNumber !== position.stringNumber && p.fret <= maxFret)
    .sort((a, b) => a.fret - b.fret)
}
