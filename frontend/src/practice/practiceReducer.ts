// Practice session state. Phase 1 covers song-position navigation only;
// listening/feedback states are added in Phases 2–3 on top of the same reducer.

export type PracticeState = {
  noteCount: number
  currentIndex: number
}

export type PracticeAction =
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'jumpTo'; index: number }
  | { type: 'reset' }

export function createPracticeState(noteCount: number): PracticeState {
  return { noteCount, currentIndex: 0 }
}

function clampIndex(index: number, noteCount: number): number {
  if (noteCount === 0) return 0
  return Math.min(Math.max(Math.trunc(index), 0), noteCount - 1)
}

export function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  let index: number
  switch (action.type) {
    case 'next':
      index = state.currentIndex + 1
      break
    case 'previous':
      index = state.currentIndex - 1
      break
    case 'jumpTo':
      index = action.index
      break
    case 'reset':
      index = 0
      break
  }
  const currentIndex = clampIndex(index, state.noteCount)
  return currentIndex === state.currentIndex ? state : { ...state, currentIndex }
}

export function isFirstNote(state: PracticeState): boolean {
  return state.currentIndex === 0
}

export function isLastNote(state: PracticeState): boolean {
  return state.currentIndex >= state.noteCount - 1
}
