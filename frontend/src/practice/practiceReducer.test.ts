import { describe, expect, it } from 'vitest'
import { createPracticeState, isFirstNote, isLastNote, practiceReducer, type PracticeAction } from './practiceReducer'

const run = (noteCount: number, ...actions: PracticeAction[]) =>
  actions.reduce(practiceReducer, createPracticeState(noteCount))

describe('practiceReducer navigation', () => {
  it('starts at the first note', () => {
    const state = createPracticeState(5)
    expect(state.currentIndex).toBe(0)
    expect(isFirstNote(state)).toBe(true)
  })

  it('moves forward and back', () => {
    expect(run(5, { type: 'next' }, { type: 'next' }).currentIndex).toBe(2)
    expect(run(5, { type: 'next' }, { type: 'next' }, { type: 'previous' }).currentIndex).toBe(1)
  })

  it('stops at both ends', () => {
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

  it('returns the same object when nothing changes', () => {
    const state = createPracticeState(3)
    expect(practiceReducer(state, { type: 'previous' })).toBe(state)
  })
})
