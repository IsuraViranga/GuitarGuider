// Turns a stream of pitch readings (~40 per second) into "a note was played" events.
//
// Rules, in plain words:
// - Every played note starts with a pluck: a sudden rise in loudness ("onset"). A note can
//   only be reported shortly after an onset, and each onset produces at most one note.
//   So a string that keeps ringing, a pitch that flickers while it decays, or two strings
//   blending can never invent a note by themselves.
// - The pitch must hold steady for a few readings before the note is reported.
// - "noteStart" comes first (fast; used to accept a correct note); "noteConfirmed" follows
//   after a few more steady readings (stricter; used before calling a note wrong).

import type { Stiffness } from './stringCheck'

export type RecognizerConfig = {
  /** Steady readings needed before "noteStart". */
  stableFrames: number
  /**
   * Fewer readings are enough when the expected note is very clearly present (short, soft
   * notes a beginner lifts quickly may only be clear for ~50 ms).
   */
  strongFrames: number
  /** Steady readings needed before "noteConfirmed". */
  confirmFrames: number
  /** Readings within this many cents of the note's centre count as the same note. */
  stabilityCents: number
  /** Unreliable readings in a row that mean the note has stopped. */
  releaseFrames: number
  /** A note must start within this long after a pluck (onset) to be reported. */
  onsetWindowMs: number
}

export const DEFAULT_RECOGNIZER_CONFIG: RecognizerConfig = {
  stableFrames: 3,
  strongFrames: 2,
  confirmFrames: 5,
  stabilityCents: 35,
  releaseFrames: 3,
  onsetWindowMs: 200,
}

/**
 * One reading. `midi` is a fractional MIDI pitch, or null when the reading was unreliable.
 * `onset` is true when this reading is the start of a pluck (a sudden rise in loudness).
 */
export type RecognizerInput = {
  time: number
  midi: number | null
  rms: number
  onset?: boolean
  /** The reading is an expected note, very clearly present. */
  strong?: boolean
}

export type NoteEvent = {
  type: 'noteStart' | 'noteConfirmed'
  /** Same id for the start and confirmation of one played note. */
  noteId: number
  /** Fractional MIDI pitch (median of the steady readings). */
  midi: number
  time: number
  /**
   * String check only (see stringCheck.ts): the string's measured stiffness, or null when it could
   * not be measured. Absent when no string check was asked for.
   */
  stiffness?: Stiffness | null
}

type Run = {
  id: number
  pitches: number[]
  center: number
  count: number
  /** Readings in this run that were the expected note, very clearly present. */
  strongCount: number
  /** The pluck this run belongs to, or null if it began without one (it can never be reported). */
  onsetTime: number | null
  startEmitted: boolean
  confirmEmitted: boolean
  /** Set by reset(): this note was already sounding, so it must not produce events. */
  blocked: boolean
}

const MAX_PITCHES = 15
const HARMONIC_JUMPS = [12, 19, 24] // octave, octave + fifth, two octaves

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export class NoteRecognizer {
  private readonly config: RecognizerConfig
  private run: Run | null = null
  private missedFrames = 0
  private nextId = 1
  private lastOnset = -Infinity
  /** The pluck that already produced a note; it cannot produce another. */
  private usedOnset: number | null = null

  constructor(config: RecognizerConfig = DEFAULT_RECOGNIZER_CONFIG) {
    this.config = config
  }

  push(input: RecognizerInput): NoteEvent[] {
    if (input.onset) this.lastOnset = input.time

    if (input.midi === null) {
      this.missedFrames++
      if (this.missedFrames >= this.config.releaseFrames) this.run = null
      return []
    }
    this.missedFrames = 0

    const run = this.run
    if (!run) {
      this.startRun(input)
    } else if (this.lastOnset > (run.onsetTime ?? -Infinity) && this.isRecentOnset(input.time)) {
      // A new pluck since this note began: a new note, even at the same pitch ("10 10").
      this.startRun(input)
    } else {
      const distance = input.midi - run.center
      if (Math.abs(distance) * 100 <= this.config.stabilityCents) {
        this.extendRun(run, input.midi, input.strong ?? false)
      } else if (run.count >= this.config.stableFrames && this.isHarmonicJump(distance)) {
        // An overtone of a string that is already ringing: ignore this reading.
        return []
      } else {
        this.startRun(input)
      }
    }
    return this.emit(input.time)
  }

  /**
   * Forget pending detection, e.g. when the student moves to another note. With
   * requireFreshOnset, a note that is still ringing can no longer produce events; only a new
   * pluck will.
   */
  reset({ requireFreshOnset = true } = {}) {
    this.missedFrames = 0
    if (requireFreshOnset) {
      if (this.run) this.run.blocked = true
      this.usedOnset = this.lastOnset
    } else {
      this.run = null
    }
  }

  private isRecentOnset(time: number): boolean {
    return time - this.lastOnset <= this.config.onsetWindowMs
  }

  private startRun(input: RecognizerInput) {
    this.run = {
      id: this.nextId++,
      pitches: [input.midi!],
      center: input.midi!,
      count: 1,
      strongCount: input.strong ? 1 : 0,
      onsetTime: this.isRecentOnset(input.time) ? this.lastOnset : null,
      startEmitted: false,
      confirmEmitted: false,
      blocked: false,
    }
  }

  private extendRun(run: Run, midi: number, strong: boolean) {
    run.pitches.push(midi)
    if (run.pitches.length > MAX_PITCHES) run.pitches.shift()
    run.center = median(run.pitches)
    run.count++
    if (strong) run.strongCount++
  }

  private isHarmonicJump(distance: number): boolean {
    const semitones = Math.abs(distance)
    return HARMONIC_JUMPS.some((jump) => Math.abs(semitones - jump) < 0.5)
  }

  private emit(time: number): NoteEvent[] {
    const run = this.run
    if (!run || run.blocked || run.onsetTime === null) return []
    // Each pluck reports at most one note (its start and its confirmation).
    if (!run.startEmitted && run.onsetTime === this.usedOnset) return []

    const events: NoteEvent[] = []
    const event = (type: NoteEvent['type']): NoteEvent => ({ type, noteId: run.id, midi: run.center, time })
    if (!run.startEmitted && (run.count >= this.config.stableFrames || run.strongCount >= this.config.strongFrames)) {
      run.startEmitted = true
      this.usedOnset = run.onsetTime
      events.push(event('noteStart'))
    }
    if (run.startEmitted && !run.confirmEmitted && run.count >= this.config.confirmFrames) {
      run.confirmEmitted = true
      events.push(event('noteConfirmed'))
    }
    return events
  }
}
