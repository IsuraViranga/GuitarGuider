// Tunings are plain data so alternative tunings can be added without code changes.

export const STRING_NUMBERS = [1, 2, 3, 4, 5, 6] as const

/** 1 = thinnest string (high E), 6 = thickest string (low E). */
export type StringNumber = (typeof STRING_NUMBERS)[number]

export const DEFAULT_MAX_FRET = 24

export type Tuning = {
  id: string
  name: string
  /** Pitch of each open string as a MIDI note number. */
  openStringMidi: Readonly<Record<StringNumber, number>>
  maxFret: number
}

export const STANDARD_TUNING: Tuning = {
  id: 'standard',
  name: 'Standard (E A D G B E)',
  openStringMidi: { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 }, // E4 B3 G3 D3 A2 E2
  maxFret: DEFAULT_MAX_FRET,
}

const TUNINGS: Readonly<Record<string, Tuning>> = {
  [STANDARD_TUNING.id]: STANDARD_TUNING,
}

export function getTuning(id: string): Tuning | undefined {
  return TUNINGS[id]
}

export function isStringNumber(value: number): value is StringNumber {
  return (STRING_NUMBERS as readonly number[]).includes(value)
}
