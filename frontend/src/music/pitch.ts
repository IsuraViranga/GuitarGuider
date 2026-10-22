// Pitch helpers. Internally every pitch is a MIDI note number:
// 60 = C4 ("middle C"), 69 = A4 (440 Hz). Each +1 is one semitone (one fret).

export const A4_MIDI = 69
export const A4_FREQUENCY = 440

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export type NoteName = {
  /** Letter plus optional sharp, e.g. "G#" */
  pitchClass: (typeof NOTE_NAMES)[number]
  octave: number
  /** e.g. "G#3" */
  label: string
}

export function midiToFrequency(midi: number): number {
  return A4_FREQUENCY * 2 ** ((midi - A4_MIDI) / 12)
}

/** Returns a fractional MIDI number, e.g. 440 Hz → 69, 445 Hz → ~69.2 */
export function frequencyToMidi(frequency: number): number {
  if (!(frequency > 0)) {
    throw new RangeError(`Frequency must be a positive number, got ${frequency}`)
  }
  return A4_MIDI + 12 * Math.log2(frequency / A4_FREQUENCY)
}

/** Distance from `reference` to `pitch` in cents (100 cents = 1 semitone). */
export function centsBetween(reference: number, pitch: number): number {
  return (pitch - reference) * 100
}

export function midiToNoteName(midi: number): NoteName {
  if (!Number.isInteger(midi)) {
    throw new RangeError(`MIDI note must be a whole number, got ${midi}`)
  }
  const pitchClass = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return { pitchClass, octave, label: `${pitchClass}${octave}` }
}

export function formatFrequency(frequency: number): string {
  return `${frequency.toFixed(2)} Hz`
}
