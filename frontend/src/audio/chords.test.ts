// Chord checking on generated strums (each string plucked 15 ms after the previous one, previous
// chord still ringing on strings that are not re-strummed), through the real detection chain and
// practice rules.

import { describe, expect, it } from 'vitest'
import { chordShape } from '../music/chords'
import { positionToMidi } from '../music/fretboard'
import { createPracticeState, practiceReducer, type PracticeMode, type PracticeState } from '../practice/practiceReducer'
import { perform, SAMPLE_RATE, type PlayedNote } from '../test/synth'
import { CHORD_FRAME_SIZE, createChordChecker, heardChordName, verifyChord } from './chroma'
import { DEFAULT_TRACKER_CONFIG, PitchTracker } from './pitchTracker'

const chordTones = (name: string) => {
  const shape = chordShape(name)
  if (!shape.ok) throw new Error(shape.error)
  return shape.value.positions.map((p) => ({ midi: positionToMidi(p), stringNumber: p.stringNumber }))
}
const strum = (name: string, start: number): PlayedNote[] => chordTones(name).map((t, k) => ({ ...t, start: start + k * 0.015 }))

describe('chord check on a single strum', () => {
  const check = createChordChecker(SAMPLE_RATE)
  const at = (played: string, seconds: number) => {
    const signal = perform(strum(played, 0.3), 2.5)
    const end = Math.round(seconds * SAMPLE_RATE)
    return check(signal.subarray(end - CHORD_FRAME_SIZE, end))
  }
  const midis = (name: string) => chordTones(name).map((t) => t.midi)

  it.each(['C', 'G', 'Am', 'F', 'D', 'Em', 'E', 'A', 'Dm', 'E7', 'Bm', 'F#m'])('recognises %s as the expected chord', (name) => {
    for (const seconds of [0.5, 0.8, 1.5]) expect(verifyChord(at(name, seconds), midis(name)), `${name} at ${seconds}s`).toBe('match')
  })

  it.each([
    ['G', 'C'], ['Am', 'C'], ['C', 'Am'], ['Em', 'G'], ['D', 'Dm'], ['E', 'Em'], ['F', 'Dm'], ['Am', 'F'], ['C', 'Em'],
  ])('rejects %s when %s is expected', (played, expected) => {
    for (const seconds of [0.5, 0.8]) expect(verifyChord(at(played, seconds), midis(expected)), `${played} for ${expected}`).toBe('other')
  })

  it('names the chord that was actually played', () => {
    expect(heardChordName(at('G', 0.8))).toBe('G')
    expect(heardChordName(at('Am', 0.8))).toBe('Am')
    expect(heardChordName(at('D', 0.8))).toBe('D')
  })
})

describe('chord songs through the detection chain and practice rules', () => {
  const LEAD = 1.2

  function practiseChords(song: string[], played: PlayedNote[], seconds: number, mode: PracticeMode = 'strict') {
    const steps = song.map(chordTones)
    let state: PracticeState = createPracticeState(
      steps.map((tones) => Math.min(...tones.map((t) => t.midi))),
      steps.map(() => null),
      mode,
      steps.map((tones) => tones.map((t) => ({ midi: t.midi, string: t.stringNumber }))),
    )
    const signal = perform(played, seconds)
    const tracker = new PitchTracker(SAMPLE_RATE, 2048, DEFAULT_TRACKER_CONFIG)
    const setTargets = () => {
      const coming = state.completed ? [] : steps.slice(state.currentIndex, state.currentIndex + (mode === 'flow' ? 2 : 1))
      tracker.setChordTargets(coming.map((tones) => tones.map((t) => t.midi)))
    }
    setTargets()
    const heard: Array<string | null> = []
    for (let end = 2048; end <= signal.length; end += 1200) {
      const time = (end / SAMPLE_RATE) * 1000
      const result = tracker.process(signal.subarray(Math.max(0, end - CHORD_FRAME_SIZE), end), time)
      for (const event of result.chordEvents) {
        const before = state
        state = practiceReducer(state, { type: 'chordEvent', event })
        if (event.type === 'chordWrong') heard.push(event.heard)
        if (state.positionVersion !== before.positionVersion) {
          tracker.resetNotes({ requireFreshOnset: true })
          setTargets()
        }
      }
    }
    return { state, heard }
  }

  const SONG = ['C', 'G', 'Am', 'F', 'C', 'Dm', 'G', 'C']

  it.each([1.2, 0.8])('follows a chord song strummed every %s s, each chord once, no mistakes', (secondsPerChord) => {
    const played = SONG.flatMap((name, i) => strum(name, LEAD + i * secondsPerChord))
    const { state } = practiseChords(SONG, played, LEAD + SONG.length * secondsPerChord + 1)
    expect(state.completed).toBe(true)
    expect(state.wrongCount).toBe(0)
  })

  it('stays on a chord when a different chord is strummed, and names it', () => {
    // C expected, G strummed, then C.
    const played = [...strum('G', LEAD), ...strum('C', LEAD + 1.2)]
    const { state, heard } = practiseChords(['C', 'Am'], played, LEAD + 2.6)
    expect(state.currentIndex).toBe(1) // C finally accepted, now on Am
    expect(state.wrongCount).toBe(1)
    expect(heard).toEqual(['G'])
  })

  it('a chord left ringing does not complete the next identical chord', () => {
    const { state } = practiseChords(['C', 'C'], strum('C', LEAD), LEAD + 3)
    expect(state.currentIndex).toBe(1)
    expect(state.completed).toBe(false)
  })

  it('play-through catches up when a chord was missed', () => {
    // Song C G Am: the G strum is never played; Am follows C.
    const played = [...strum('C', LEAD), ...strum('Am', LEAD + 1.2)]
    const { state } = practiseChords(['C', 'G', 'Am'], played, LEAD + 2.6, 'flow')
    expect(state.completed).toBe(true)
    expect(state.skippedCount).toBe(1)
  })
})
