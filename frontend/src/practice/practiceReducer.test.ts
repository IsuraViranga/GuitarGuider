import { describe, expect, it } from 'vitest'
import type { NoteEvent } from '../audio/noteRecognizer'
import { createPracticeState, isFirstNote, isLastNote, practiceReducer, type PracticeAction, type PracticeState } from './practiceReducer'

const E4 = 64
const F4 = 65
const G4 = 67

const run = (targets: number[] | number, ...actions: PracticeAction[]) =>
  actions.reduce(practiceReducer, createPracticeState(Array.isArray(targets) ? targets : Array(targets).fill(E4)))

let nextId = 100
/** A played note as the detector reports it: start, then confirmation, same id. */
const played = (midi: number, id = nextId++): PracticeAction[] => [
  { type: 'noteEvent', event: { type: 'noteStart', noteId: id, midi, time: 0 } satisfies NoteEvent },
  { type: 'noteEvent', event: { type: 'noteConfirmed', noteId: id, midi, time: 50 } satisfies NoteEvent },
]
const startOnly = (midi: number, id = nextId++): PracticeAction => ({
  type: 'noteEvent',
  event: { type: 'noteStart', noteId: id, midi, time: 0 },
})

describe('navigation', () => {
  it('starts at the first note', () => {
    const state = createPracticeState([E4, F4])
    expect(state.currentIndex).toBe(0)
    expect(isFirstNote(state)).toBe(true)
    expect(state.feedback.kind).toBe('none')
  })

  it('moves forward and back, stopping at both ends', () => {
    expect(run(5, { type: 'next' }, { type: 'next' }, { type: 'previous' }).currentIndex).toBe(1)
    expect(run(3, { type: 'previous' }).currentIndex).toBe(0)
    const end = run(3, { type: 'next' }, { type: 'next' }, { type: 'next' })
    expect(end.currentIndex).toBe(2)
    expect(isLastNote(end)).toBe(true)
  })

  it('jumps directly to any note and clamps out-of-range targets', () => {
    expect(run(10, { type: 'jumpTo', index: 7 }).currentIndex).toBe(7)
    expect(run(10, { type: 'jumpTo', index: 99 }).currentIndex).toBe(9)
    expect(run(10, { type: 'jumpTo', index: -4 }).currentIndex).toBe(0)
  })

  it('reset returns to the beginning (different from one step back)', () => {
    const state = run(10, { type: 'jumpTo', index: 6 })
    expect(practiceReducer(state, { type: 'reset' }).currentIndex).toBe(0)
    expect(practiceReducer(state, { type: 'previous' }).currentIndex).toBe(5)
  })

  it('every position change bumps positionVersion and clears feedback', () => {
    const wrong = run([E4, F4], ...played(G4))
    expect(wrong.feedback.kind).toBe('incorrect')
    for (const action of [{ type: 'next' }, { type: 'previous' }, { type: 'jumpTo', index: 0 }, { type: 'reset' }] as const) {
      const moved = practiceReducer(wrong, action)
      expect(moved.feedback.kind).toBe('none')
      expect(moved.positionVersion).toBe(wrong.positionVersion + 1)
      expect(moved.handledNoteId).toBeNull()
    }
  })
})

describe('correct notes (§7.1)', () => {
  it('advances to the next note with correct feedback', () => {
    const state = run([E4, F4, G4], ...played(E4))
    expect(state.currentIndex).toBe(1)
    expect(state.feedback).toMatchObject({ kind: 'correct', noteIndex: 0, heardMidi: E4 })
  })

  it('accepts on the fast noteStart event', () => {
    expect(run([E4, F4], startOnly(E4)).currentIndex).toBe(1)
  })

  it('advances only once per played note (its confirmation is ignored)', () => {
    // E4 then E4 again: the confirmation of the first pluck must not satisfy note 2.
    const state = run([E4, E4, E4], ...played(E4, 1))
    expect(state.currentIndex).toBe(1)
  })

  it('accepts small tuning differences', () => {
    expect(run([E4, F4], ...played(E4 + 0.3)).currentIndex).toBe(1)
  })

  it('a fresh pluck of the same pitch advances again (repeated notes)', () => {
    expect(run([E4, E4, E4], ...played(E4), ...played(E4)).currentIndex).toBe(2)
  })

  it('completes the song after the last note, and ignores notes afterwards', () => {
    const done = run([E4, F4], ...played(E4), ...played(F4))
    expect(done.completed).toBe(true)
    expect(done.currentIndex).toBe(1)
    const after = practiceReducer(done, played(G4)[1])
    expect(after).toBe(done) // unchanged: no feedback, no mistake counted
  })
})

describe('wrong notes (§7.2)', () => {
  it('shows the mistake and stays on the same note', () => {
    const state = run([E4, F4], ...played(G4))
    expect(state.currentIndex).toBe(0)
    expect(state.feedback).toMatchObject({ kind: 'incorrect', noteIndex: 0, targetMidi: E4, heardMidi: G4 })
    expect(state.wrongCount).toBe(1)
  })

  it('waits for confirmation before calling a note wrong', () => {
    const state = run([E4, F4], startOnly(G4))
    expect(state.feedback.kind).toBe('none')
    expect(state.feedbackId).toBe(0)
  })

  it('produces one result per wrong note, however long it rings', () => {
    const id = 7
    const once = run([E4, F4], ...played(G4, id))
    const again = run([E4, F4], ...played(G4, id), ...played(G4, id))
    expect(again.feedbackId).toBe(once.feedbackId)
    expect(again.wrongCount).toBe(1)
  })

  it('a correct note after a mistake advances', () => {
    const state = run([E4, F4], ...played(G4), ...played(E4))
    expect(state.currentIndex).toBe(1)
    expect(state.feedback.kind).toBe('correct')
  })

  it('treats the right note in the wrong octave as wrong, and says so', () => {
    expect(run([E4, F4], ...played(E4 - 12)).feedback).toMatchObject({ kind: 'incorrect', octaveOff: true })
  })
})

describe('out-of-tune guitars', () => {
  it('accepts a note up to 70 cents off as correct, with a tuning hint', () => {
    // Real case from a student's phone: D4 expected, 304.46 Hz heard (62 cents sharp).
    const state: PracticeState = run([E4 - 2, F4], ...played(E4 - 2 + 0.62))
    expect(state.currentIndex).toBe(1)
    expect(state.wrongCount).toBe(0)
    expect(state.feedback).toMatchObject({ kind: 'correct', inTune: false })
  })

  it('learns that a string is out of tune and allows for it (real case: string 2 at +62 then +72)', () => {
    const D4 = 62
    const strings = [2, 2, 2]
    let state = createPracticeState([D4, D4, D4], strings)
    for (const action of [...played(D4 + 0.62), ...played(D4 + 0.72), ...played(D4 + 0.72)]) state = practiceReducer(state, action)
    expect(state.completed).toBe(true)
    expect(state.wrongCount).toBe(0)
    expect(state.tuningOffsets[2]).toBeGreaterThan(40)
    expect(state.feedback).toMatchObject({ kind: 'correct', inTune: false }) // still tells the student to tune
  })

  it('a wrong fret is still wrong on a string learned to be sharp', () => {
    const D4 = 62
    let state = createPracticeState([D4, D4, D4, D4], [2, 2, 2, 2])
    for (const action of [...played(D4 + 0.6), ...played(D4 + 0.6), ...played(D4 + 0.6)]) state = practiceReducer(state, action)
    const fretUp = practiceReducer(practiceReducer(state, played(D4 + 1.6)[0]), played(D4 + 1.6)[1])
    const fretDown = practiceReducer(practiceReducer(state, played(D4 - 0.4)[0]), played(D4 - 0.4)[1])
    expect(fretUp.feedback.kind).toBe('incorrect')
    expect(fretDown.feedback.kind).toBe('incorrect')
  })

  it('still calls the next fret (about 100 cents) wrong', () => {
    expect(run([E4, F4], ...played(E4 + 0.95)).feedback.kind).toBe('incorrect')
  })
})

describe('play-through mode', () => {
  const flow = (targets: number[], ...actions: PracticeAction[]) =>
    actions.reduce(practiceReducer, createPracticeState(targets, targets.map(() => 1), 'flow'))

  it('catches up when the student is already on the next note (a missed note)', () => {
    const state = flow([E4, F4, G4], ...played(F4))
    expect(state.currentIndex).toBe(2)
    expect(state.feedback).toMatchObject({ kind: 'correct', noteIndex: 1, skipped: 1 })
    expect(state.skippedCount).toBe(1)
    expect(state.wrongCount).toBe(0)
  })

  it('looks only one note ahead (measured on real recordings: two caused false jumps)', () => {
    expect(flow([E4, F4, G4], ...played(G4)).feedback.kind).toBe('incorrect')
  })

  it('still calls a note that is not coming up wrong', () => {
    const state = flow([E4, F4, G4], ...played(E4 + 10))
    expect(state.currentIndex).toBe(0)
    expect(state.feedback.kind).toBe('incorrect')
  })

  it('note-by-note mode never skips ahead (the brief rule)', () => {
    const state = run([E4, F4, G4], ...played(F4))
    expect(state.currentIndex).toBe(0)
    expect(state.feedback.kind).toBe('incorrect')
  })

  it('a whole song played fast with two notes missed by the detector still finishes', () => {
    // E4 F4 G4 F4 E4: the 2nd and 4th notes were never detected.
    const state = flow([E4, F4, G4, F4, E4], ...played(E4), ...played(G4), ...played(E4))
    expect(state.completed).toBe(true)
    expect(state.skippedCount).toBe(2)
  })
})
