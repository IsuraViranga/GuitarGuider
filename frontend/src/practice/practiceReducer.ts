// Practice session state: where the student is in the song, and what the last played note
// was judged as. Pure logic (no audio, no React), so every practice rule is unit-tested.
//
// Rules (project brief §7–8):
// - Correct note → green feedback, advance exactly once. (No sound: handled by the page.)
// - Wrong note → red feedback, stay on the same note. Only judged on the stricter
//   "noteConfirmed" event, so a brief unclear sound never counts as a mistake.
// - Each detected note (noteId) is handled at most once: a ringing note can't advance twice.
// - A slightly out-of-tune note still counts (see matching.ts); the feedback adds a tuning hint.
// - Any position change (automatic or manual) clears feedback and bumps positionVersion,
//   which tells the listener to ignore notes still ringing from before.

import type { NoteEvent } from '../audio/noteRecognizer'
import { compareToTarget } from './matching'

export type Feedback =
  | { kind: 'none' }
  | { kind: 'correct'; noteIndex: number; heardMidi: number; cents: number; inTune: boolean }
  | { kind: 'incorrect'; noteIndex: number; targetMidi: number; detectedMidi: number; heardMidi: number; octaveOff: boolean }

export type PracticeState = {
  /** Expected pitch (MIDI) of every note in the song. */
  targets: readonly number[]
  currentIndex: number
  completed: boolean
  feedback: Feedback
  /** Increases with every new feedback; lets the page react once (e.g. one error sound). */
  feedbackId: number
  /** Increases with every position change, automatic or manual. */
  positionVersion: number
  /** The detected note that already produced a result; its later events are ignored. */
  handledNoteId: number | null
  wrongCount: number
}

export type PracticeAction =
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'jumpTo'; index: number }
  | { type: 'reset' }
  | { type: 'noteEvent'; event: NoteEvent }

export function createPracticeState(targets: readonly number[]): PracticeState {
  return {
    targets,
    currentIndex: 0,
    completed: false,
    feedback: { kind: 'none' },
    feedbackId: 0,
    positionVersion: 0,
    handledNoteId: null,
    wrongCount: 0,
  }
}

function clampIndex(index: number, noteCount: number): number {
  if (noteCount === 0) return 0
  return Math.min(Math.max(Math.trunc(index), 0), noteCount - 1)
}

function moveTo(state: PracticeState, index: number): PracticeState {
  return {
    ...state,
    currentIndex: clampIndex(index, state.targets.length),
    completed: false,
    feedback: { kind: 'none' },
    positionVersion: state.positionVersion + 1,
    handledNoteId: null,
  }
}

function handleNote(state: PracticeState, event: NoteEvent): PracticeState {
  if (state.completed || event.noteId === state.handledNoteId) return state

  const noteIndex = state.currentIndex
  const targetMidi = state.targets[noteIndex]
  const { result, cents, heardMidi, octaveOff, inTune } = compareToTarget(event.midi, targetMidi)

  if (result === 'correct') {
    const isLast = noteIndex >= state.targets.length - 1
    return {
      ...state,
      currentIndex: isLast ? noteIndex : noteIndex + 1,
      completed: isLast,
      feedback: { kind: 'correct', noteIndex, heardMidi, cents, inTune },
      feedbackId: state.feedbackId + 1,
      positionVersion: state.positionVersion + 1,
      handledNoteId: event.noteId,
    }
  }

  // Wrong: wait for the stricter confirmation before telling the student.
  if (event.type !== 'noteConfirmed') return state
  return {
    ...state,
    feedback: { kind: 'incorrect', noteIndex, targetMidi, detectedMidi: event.midi, heardMidi, octaveOff },
    feedbackId: state.feedbackId + 1,
    handledNoteId: event.noteId,
    wrongCount: state.wrongCount + 1,
  }
}

export function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  switch (action.type) {
    case 'next':
      return moveTo(state, state.currentIndex + 1)
    case 'previous':
      return moveTo(state, state.currentIndex - 1)
    case 'jumpTo':
      return moveTo(state, action.index)
    case 'reset':
      return { ...moveTo(state, 0), wrongCount: 0 }
    case 'noteEvent':
      return handleNote(state, action.event)
  }
}

export function isFirstNote(state: PracticeState): boolean {
  return state.currentIndex === 0
}

export function isLastNote(state: PracticeState): boolean {
  return state.currentIndex >= state.targets.length - 1
}
