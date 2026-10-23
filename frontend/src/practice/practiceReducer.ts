// Practice session state: where the student is in the song, and what the last played note
// was judged as. Pure logic (no audio, no React), so every practice rule is unit-tested.
//
// Rules (project brief §7–8):
// - Correct note → green feedback, advance exactly once. (No sound: handled by the page.)
// - Wrong note → red feedback, stay on the same note. Only judged on the stricter
//   "noteConfirmed" event, so a brief unclear sound never counts as a mistake.
// - Each detected note (noteId) is handled at most once: a ringing note can't advance twice.
// - A slightly out-of-tune note still counts (see matching.ts); the feedback adds a tuning hint.
// - Each string's tuning error is learned from the notes played correctly on it and allowed for
//   (at most ±50 cents), like a teacher who knows "your B string is a bit sharp". A wrong fret
//   (about 100 cents) is still caught.
// - Any position change (automatic or manual) clears feedback and bumps positionVersion,
//   which tells the listener to ignore notes still ringing from before.

import type { NoteEvent } from '../audio/noteRecognizer'
import { compareToTarget } from './matching'

export type Feedback =
  | { kind: 'none' }
  | { kind: 'correct'; noteIndex: number; heardMidi: number; cents: number; inTune: boolean; skipped: number }
  | { kind: 'incorrect'; noteIndex: number; targetMidi: number; detectedMidi: number; heardMidi: number; octaveOff: boolean }

/**
 * strict = note by note: stays on a note until it is played (the brief's rule).
 * flow = play through: if the student plays one of the next notes, the app catches up, so
 *        fast playing is followed even when a note was missed.
 */
export type PracticeMode = 'strict' | 'flow'

/** In play-through mode, how many notes ahead of the current one are recognised. */
export const FLOW_LOOKAHEAD = 1

export type PracticeState = {
  mode: PracticeMode
  /** Notes passed over in play-through mode because a later note was played. */
  skippedCount: number
  /** Expected pitch (MIDI) of every note in the song. */
  targets: readonly number[]
  /** Intended string of every note (null when unknown), used to learn per-string tuning. */
  targetStrings: readonly (number | null)[]
  /** Learned tuning error per string, in cents (positive = sharp). */
  tuningOffsets: Readonly<Record<number, number>>
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
  | { type: 'setMode'; mode: PracticeMode }

export function createPracticeState(
  targets: readonly number[],
  targetStrings: readonly (number | null)[] = targets.map(() => null),
  mode: PracticeMode = 'strict',
): PracticeState {
  return {
    mode,
    skippedCount: 0,
    targets,
    targetStrings,
    tuningOffsets: {},
    currentIndex: 0,
    completed: false,
    feedback: { kind: 'none' },
    feedbackId: 0,
    positionVersion: 0,
    handledNoteId: null,
    wrongCount: 0,
  }
}

/** How quickly a string's tuning error is learned from each correct note (0–1). */
const TUNING_LEARN_RATE = 0.5
/** Largest tuning error that is allowed for, in cents. */
const MAX_TUNING_OFFSET = 50

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
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

/** Compares a played note with song note `index`, allowing for that string's known tuning error. */
function judge(state: PracticeState, index: number, midi: number) {
  const string = state.targetStrings[index]
  const offset = string === null ? 0 : (state.tuningOffsets[string] ?? 0)
  const compensated = compareToTarget(midi - offset / 100, state.targets[index])
  const raw = compareToTarget(midi, state.targets[index])
  return { ...compensated, cents: raw.cents, inTune: raw.inTune, string, offset }
}

function accept(state: PracticeState, index: number, event: NoteEvent, skipped: number): PracticeState {
  const { string, offset, cents, inTune, heardMidi } = judge(state, index, event.midi)
  const isLast = index >= state.targets.length - 1
  const tuningOffsets =
    string === null
      ? state.tuningOffsets
      : { ...state.tuningOffsets, [string]: clamp(offset * (1 - TUNING_LEARN_RATE) + cents * TUNING_LEARN_RATE, MAX_TUNING_OFFSET) }
  return {
    ...state,
    tuningOffsets,
    currentIndex: isLast ? index : index + 1,
    completed: isLast,
    feedback: { kind: 'correct', noteIndex: index, heardMidi, cents, inTune, skipped },
    feedbackId: state.feedbackId + 1,
    positionVersion: state.positionVersion + 1,
    handledNoteId: event.noteId,
    skippedCount: state.skippedCount + skipped,
  }
}

function handleNote(state: PracticeState, event: NoteEvent): PracticeState {
  if (state.completed || event.noteId === state.handledNoteId) return state

  const noteIndex = state.currentIndex
  const current = judge(state, noteIndex, event.midi)
  if (current.result === 'correct') return accept(state, noteIndex, event, 0)

  // Play-through mode: the student may already be on one of the next notes (the app missed a
  // note while they played on). Catch up instead of holding everything back.
  if (state.mode === 'flow') {
    for (let ahead = 1; ahead <= FLOW_LOOKAHEAD && noteIndex + ahead < state.targets.length; ahead++) {
      if (judge(state, noteIndex + ahead, event.midi).result === 'correct') return accept(state, noteIndex + ahead, event, ahead)
    }
  }

  // Wrong: wait for the stricter confirmation before telling the student.
  if (event.type !== 'noteConfirmed') return state
  return {
    ...state,
    feedback: {
      kind: 'incorrect',
      noteIndex,
      targetMidi: state.targets[noteIndex],
      detectedMidi: event.midi,
      heardMidi: current.heardMidi,
      octaveOff: current.octaveOff,
    },
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
      return { ...moveTo(state, 0), wrongCount: 0, skippedCount: 0 }
    case 'setMode':
      return { ...state, mode: action.mode }
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
