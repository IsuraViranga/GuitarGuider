// End-to-end practice simulation: a simulated student plays a whole song on a realistic
// guitar (previous strings keep ringing), and the real detection chain and practice rules
// must follow along: every note accepted once, quickly, with no skipping and no false alarms.

import { describe, expect, it } from 'vitest'
import { parseGuitarNumber } from '../music/guitarNumber'
import { positionToMidi } from '../music/fretboard'
import { createPracticeState, practiceReducer, type PracticeState } from '../practice/practiceReducer'
import { perform, SAMPLE_RATE, type PlayedNote } from '../test/synth'
import { PitchTracker } from './pitchTracker'

const LEAD = 1.2 // quiet start for calibration

const parse = (numbers: string) =>
  numbers.split(' ').map((n) => {
    const p = parseGuitarNumber(n)
    if (!p.ok) throw new Error(p.error)
    return { midi: positionToMidi(p.value), stringNumber: p.value.stringNumber }
  })

/** Plays `played` while the app expects `song`; returns the final practice state and accept times. */
function practise(song: number[], played: PlayedNote[], seconds: number) {
  const signal = perform(played, seconds)
  const tracker = new PitchTracker(SAMPLE_RATE, 2048)
  let state: PracticeState = createPracticeState(song)
  tracker.setTarget(song[0])
  const acceptedAt: number[] = []
  const hop = 1200 // 25 ms, like the live app
  for (let end = 2048; end <= signal.length; end += hop) {
    const time = (end / SAMPLE_RATE) * 1000
    for (const event of tracker.process(signal.subarray(end - 2048, end), time).events) {
      const before = state
      state = practiceReducer(state, { type: 'noteEvent', event })
      if (state.positionVersion !== before.positionVersion) {
        // What the practice page does after every move.
        acceptedAt[before.currentIndex] = time
        tracker.resetNotes({ requireFreshOnset: true })
        tracker.setTarget(state.completed ? null : song[state.currentIndex])
      }
    }
  }
  return { state, acceptedAt }
}

// Fastest tempo (seconds per note) each passes at. Faster than this fails only when several
// other strings are left ringing (a dense blend). Beginners typically play 0.3–1 s per note.
const SONGS: Array<[string, ReturnType<typeof parse>, number[]]> = [
  ['Ode to Joy', parse('10 10 11 13 13 11 10 23 21 21 23 10 10 23 23'), [0.6, 0.4, 0.3, 0.22]],
  ['C major scale', parse('53 40 42 43 30 32 20 21 21 20 32 30 43 42 40 53'), [0.6, 0.4, 0.3]],
  ['open strings, all left ringing', parse('60 50 40 30 20 10 10 20 30 40 50 60'), [0.6, 0.4]],
]

describe.each(SONGS)('%s', (_name, notes, tempos) => {
  it.each(tempos)('played at %s s per note: every note accepted once, quickly, no mistakes', (secondsPerNote) => {
    const played = notes.map((n, i) => ({ ...n, start: LEAD + i * secondsPerNote }))
    const { state, acceptedAt } = practise(
      notes.map((n) => n.midi),
      played,
      LEAD + notes.length * secondsPerNote + 1,
    )
    const missing = notes.map((_, i) => i + 1).filter((n) => acceptedAt[n - 1] === undefined)
    expect(missing, `notes not accepted: ${missing.join(', ')}`).toEqual([])
    expect(state.completed).toBe(true)
    expect(state.wrongCount).toBe(0)
    const latencies = played.map((p, i) => acceptedAt[i] - p.start * 1000)
    expect(Math.max(...latencies), `latencies: ${latencies.map((l) => l.toFixed(0)).join(' ')}`).toBeLessThan(150)
  })
})

describe('no false acceptance', () => {
  const E4 = 64
  const D4 = 62
  const C4 = 60

  it('a wrong note is not accepted while the expected pitch rings on another string', () => {
    // Song 10 23 10. The student plays 10 and 23 correctly, then 21 (C4) instead of 10,
    // while the first E4 is still ringing on string 1.
    const played = [
      { midi: E4, stringNumber: 1, start: LEAD },
      { midi: D4, stringNumber: 2, start: LEAD + 0.4 },
      { midi: C4, stringNumber: 2, start: LEAD + 0.8 },
    ]
    const { state } = practise([E4, D4, E4], played, LEAD + 2.5)
    expect(state.currentIndex).toBe(2)
    expect(state.completed).toBe(false)
    expect(state.wrongCount).toBe(1)
  })

  it('the right note an octave too high is not accepted', () => {
    const { state } = practise([D4], [{ midi: D4 + 12, stringNumber: 1, start: LEAD }], LEAD + 2)
    expect(state.completed).toBe(false)
    expect(state.feedback).toMatchObject({ kind: 'incorrect', octaveOff: true })
  })

  it('a note left ringing never completes the next identical note by itself', () => {
    const { state } = practise([E4, E4], [{ midi: E4, stringNumber: 1, start: LEAD }], LEAD + 3)
    expect(state.currentIndex).toBe(1)
    expect(state.completed).toBe(false)
  })
})

describe('out-of-tune guitar', () => {
  it('follows a song played on a guitar whose strings are 50–60 cents sharp', () => {
    const notes = parse('10 10 11 13 13 11 10 23 21 21 23 10 10 23 23')
    const sharp = (n: { midi: number; stringNumber: number }) => n.midi + (n.stringNumber === 2 ? 0.6 : 0.5)
    const played = notes.map((n, i) => ({ midi: sharp(n), stringNumber: n.stringNumber, start: LEAD + i * 0.4 }))
    const { state } = practise(
      notes.map((n) => n.midi),
      played,
      LEAD + notes.length * 0.4 + 1,
    )
    expect(state.completed).toBe(true)
    expect(state.wrongCount).toBe(0)
  })
})
