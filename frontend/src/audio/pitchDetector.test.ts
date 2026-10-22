import { describe, expect, it } from 'vitest'
import { STRING_NUMBERS } from '../music/tuning'
import { positionToMidi } from '../music/fretboard'
import { frequencyToMidi, midiToFrequency } from '../music/pitch'
import { harmonics, noise, pluck, SAMPLE_RATE, silence } from '../test/synth'
import { createPitchDetector } from './pitchDetector'

const FRAME = 2048
const detect = createPitchDetector(SAMPLE_RATE, FRAME)

/** Analyse a frame taken `offsetSeconds` into the signal (skips the noisy pluck attack). */
function frameAt(signal: Float32Array, offsetSeconds = 0.1) {
  const start = Math.round(offsetSeconds * SAMPLE_RATE)
  return detect(signal.subarray(start, start + FRAME))
}

const centsOff = (frequency: number, midi: number) => (frequencyToMidi(frequency) - midi) * 100

describe('YIN pitch detector', () => {
  it('finds pure tones accurately', () => {
    for (const hz of [82.41, 110, 196, 329.63, 659.26, 1318.51]) {
      const result = frameAt(harmonics(hz, 0.3, [1]))
      expect(result.clarity).toBeGreaterThan(0.95)
      expect(Math.abs(centsOff(result.frequency!, frequencyToMidi(hz)))).toBeLessThan(3)
    }
  })

  it.each(STRING_NUMBERS.flatMap((s) => [0, 5, 12].map((fret) => [s, fret] as const)))(
    'detects a plucked string %i, fret %i without octave errors',
    (stringNumber, fret) => {
      const midi = positionToMidi({ stringNumber, fret })
      const result = frameAt(pluck(midiToFrequency(midi), 0.4, { seed: stringNumber * 31 + fret }))
      expect(result.clarity).toBeGreaterThan(0.85)
      expect(Math.abs(centsOff(result.frequency!, midi))).toBeLessThan(15)
    },
  )

  it('is not fooled by a weak fundamental with strong overtones (common on low strings)', () => {
    const result = frameAt(harmonics(82.41, 0.3, [0.3, 1, 0.7, 0.5, 0.3]))
    expect(Math.round(frequencyToMidi(result.frequency!))).toBe(40) // E2, not E3
  })

  it('does not jump an octave up when a pluck has a weak fundamental', () => {
    // Found by the analysis tool: this G4 pluck was read as G5 while it rang.
    const note = pluck(392, 2.5, { amplitude: 0.4, seed: 5 })
    for (const t of [0.3, 0.8, 1.2, 1.6]) {
      expect(Math.round(frequencyToMidi(frameAt(note, t).frequency!))).toBe(67)
    }
  })

  it.each([0.6, 1.0, 1.5])('keeps every string correct late in the decay (%f s)', (t) => {
    for (const stringNumber of STRING_NUMBERS) {
      for (const fret of [0, 3, 7, 12]) {
        const midi = positionToMidi({ stringNumber, fret })
        const result = frameAt(pluck(midiToFrequency(midi), 2, { seed: stringNumber * 7 + fret }), t)
        if (result.clarity < 0.85) continue // too decayed to count; the app would ignore it
        expect(Math.round(frequencyToMidi(result.frequency!)), `string ${stringNumber} fret ${fret}`).toBe(midi)
      }
    }
  })

  it('stays accurate while a note decays', () => {
    const note = pluck(196, 2, { decay: 0.995 })
    for (const t of [0.1, 0.5, 1.0, 1.5]) {
      expect(Math.abs(centsOff(frameAt(note, t).frequency!, 55))).toBeLessThan(15)
    }
  })

  it('reports low clarity for noise and nothing for silence', () => {
    expect(frameAt(noise(0.3, 0.2)).clarity).toBeLessThan(0.6)
    expect(frameAt(silence(0.3))).toEqual({ frequency: null, clarity: 0, rms: 0 })
  })

  it('measures loudness', () => {
    const quiet = frameAt(harmonics(220, 0.3, [1], 0.05))
    const loud = frameAt(harmonics(220, 0.3, [1], 0.5))
    expect(loud.rms / quiet.rms).toBeCloseTo(10, 0)
  })

  it('works at the other common sample rate (44.1 kHz)', () => {
    const detect441 = createPitchDetector(44100, FRAME)
    const tone = Float32Array.from({ length: FRAME }, (_, i) => Math.sin((2 * Math.PI * 110 * i) / 44100))
    expect(detect441(tone).frequency).toBeCloseTo(110, 0)
  })
})
