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

import type { ChordEvent } from '../audio/chordRecognizer'
import type { NoteEvent } from '../audio/noteRecognizer'
import { compareToTarget } from './matching'

export type Feedback =
  | { kind: 'none' }
  | { kind: 'correct'; noteIndex: number; heardMidi: number; cents: number; inTune: boolean; skipped: number }
  | { kind: 'incorrect'; noteIndex: number; targetMidi: number; detectedMidi: number; heardMidi: number; octaveOff: boolean }
  | { kind: 'wrong-chord'; noteIndex: number; heard: string | null }

/**
 * strict = note by note: stays on a note until it is played (the brief's rule).
 * flow = play through: if the student plays one of the next notes, the app catches up, so
 *        fast playing is followed even when a note was missed.
 */
export type PracticeMode = 'strict' | 'flow'

export type ChordTarget = { midi: number; string: number }

/** One wrong try at a step: the note that was heard, or for chords the chord heard (null if unknown). */
export type WrongTry = { heardMidi: number } | { heardChord: string | null }

/**
 * What the student did at one step, kept for the whole session ("What you played"): every wrong
 * try, and how the step ended (played right, skipped, or not yet). A step with wrong tries stays
 * marked even after it was played right.
 */
export type StepRecord = { wrong: readonly WrongTry[]; result: 'correct' | 'skipped' | null }

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
  /**
   * For chord steps, the chord's notes (pitch + string). Chord steps are judged by chord events
   * (the whole strum), not by single notes.
   */
  targetChords: readonly (readonly ChordTarget[] | null)[]
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
  /** Correct steps in a row (a wrong note or a restart sets it back to 0), for encouragement. */
  streak: number
  bestStreak: number
  /** One record per step of the song. */
  record: readonly StepRecord[]
}

export type PracticeAction =
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'jumpTo'; index: number }
  | { type: 'reset' }
  | { type: 'noteEvent'; event: NoteEvent }
  | { type: 'chordEvent'; event: ChordEvent }
  | { type: 'setMode'; mode: PracticeMode }

export function createPracticeState(
  targets: readonly number[],
  targetStrings: readonly (number | null)[] = targets.map(() => null),
  mode: PracticeMode = 'strict',
  targetChords: readonly (readonly ChordTarget[] | null)[] = targets.map(() => null),
): PracticeState {
  return {
    targetChords,
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
    streak: 0,
    bestStreak: 0,
    record: emptyRecord(targets.length),
  }
}

function emptyRecord(length: number): StepRecord[] {
  return Array.from({ length }, () => ({ wrong: [], result: null }))
}

/** Step `index` was played right; the `skipped` steps before it (play-through) were passed over. */
function recordCorrect(record: readonly StepRecord[], index: number, skipped: number): StepRecord[] {
  return record.map((step, i) => {
    if (i === index) return { ...step, result: 'correct' }
    if (i >= index - skipped && i < index && step.result === null) return { ...step, result: 'skipped' }
    return step
  })
}

function recordWrong(record: readonly StepRecord[], index: number, wrong: WrongTry): StepRecord[] {
  return record.map((step, i) => (i === index ? { ...step, wrong: [...step.wrong, wrong] } : step))
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

/** Compares a played note with one expected pitch, allowing for that string's known tuning error. */
function judgeTone(state: PracticeState, targetMidi: number, string: number | null, midi: number) {
  const offset = string === null ? 0 : (state.tuningOffsets[string] ?? 0)
  const compensated = compareToTarget(midi - offset / 100, targetMidi)
  const raw = compareToTarget(midi, targetMidi)
  return { ...compensated, cents: raw.cents, inTune: raw.inTune, string, offset }
}

/** Compares a played note with single-note step `index`. */
function judge(state: PracticeState, index: number, midi: number) {
  return judgeTone(state, state.targets[index], state.targetStrings[index], midi)
}

function countCorrect(state: PracticeState): Pick<PracticeState, 'streak' | 'bestStreak'> {
  const streak = state.streak + 1
  return { streak, bestStreak: Math.max(state.bestStreak, streak) }
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
    ...countCorrect(state),
    record: recordCorrect(state.record, index, skipped),
  }
}

/** A strummed chord was recognised (for the current step, or the next one in play-through mode). */
function handleChord(state: PracticeState, event: ChordEvent): PracticeState {
  if (state.completed) return state
  const index = state.currentIndex
  if (event.type === 'chordStart') {
    const target = index + event.step
    if (!state.targetChords[target]) return state
    if (event.step === 0) return acceptStep(state, index, 0)
    if (state.mode === 'flow' && event.step <= FLOW_LOOKAHEAD) return acceptStep(state, target, event.step)
    return state
  }
  if (!state.targetChords[index]) return state
  return {
    ...state,
    feedback: { kind: 'wrong-chord', noteIndex: index, heard: event.heard },
    feedbackId: state.feedbackId + 1,
    wrongCount: state.wrongCount + 1,
    streak: 0,
    record: recordWrong(state.record, index, { heardChord: event.heard }),
  }
}

/** Accepts a step without a single detected note (chords). */
function acceptStep(state: PracticeState, index: number, skipped: number): PracticeState {
  const isLast = index >= state.targets.length - 1
  return {
    ...state,
    currentIndex: isLast ? index : index + 1,
    completed: isLast,
    feedback: { kind: 'correct', noteIndex: index, heardMidi: state.targets[index], cents: 0, inTune: true, skipped },
    feedbackId: state.feedbackId + 1,
    positionVersion: state.positionVersion + 1,
    handledNoteId: null,
    skippedCount: state.skippedCount + skipped,
    ...countCorrect(state),
    record: recordCorrect(state.record, index, skipped),
  }
}

function handleNote(state: PracticeState, event: NoteEvent): PracticeState {
  if (state.completed || event.noteId === state.handledNoteId) return state
  // Chord steps are judged by the whole strum (chord events), not by single notes.
  if (state.targetChords[state.currentIndex]) return state

  const noteIndex = state.currentIndex
  const current = judge(state, noteIndex, event.midi)
  if (current.result === 'correct') return accept(state, noteIndex, event, 0)

  // Play-through mode: the student may already be on one of the next notes (the app missed a
  // note while they played on). Catch up instead of holding everything back.
  if (state.mode === 'flow') {
    for (let ahead = 1; ahead <= FLOW_LOOKAHEAD && noteIndex + ahead < state.targets.length; ahead++) {
      if (state.targetChords[noteIndex + ahead]) continue
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
    streak: 0,
    record: recordWrong(state.record, noteIndex, { heardMidi: current.heardMidi }),
  }
}

export function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  switch (action.type) {
    case 'next': {
      // Moving on without playing the note counts as skipping it (playing it later still counts).
      const record = state.record.map((step, i) => (i === state.currentIndex && step.result === null ? { ...step, result: 'skipped' as const } : step))
      return { ...moveTo(state, state.currentIndex + 1), record }
    }
    case 'previous':
      return moveTo(state, state.currentIndex - 1)
    case 'jumpTo':
      return moveTo(state, action.index)
    case 'reset':
      return { ...moveTo(state, 0), wrongCount: 0, skippedCount: 0, streak: 0, bestStreak: 0, record: emptyRecord(state.targets.length) }
    case 'setMode':
      return { ...state, mode: action.mode }
    case 'noteEvent':
      return handleNote(state, action.event)
    case 'chordEvent':
      return handleChord(state, action.event)
  }
}

export function isFirstNote(state: PracticeState): boolean {
  return state.currentIndex === 0
}

export function isLastNote(state: PracticeState): boolean {
  return state.currentIndex >= state.targets.length - 1
}
