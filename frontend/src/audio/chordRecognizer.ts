// Turns per-frame chord verdicts into one decision per strum, like NoteRecognizer does for
// single notes: right after a strum (onset), a few frames agreeing on the expected chord give
// "chordStart"; frames clearly showing a different chord give "chordWrong". One decision per strum.

import type { ChordVerdict } from './chroma'

export type ChordEvent =
  | { type: 'chordStart'; strumId: number; /** 0 = current step, 1 = next step (play-through) */ step: number; time: number }
  | { type: 'chordWrong'; strumId: number; heard: string | null; time: number }

export type ChordFrame = {
  time: number
  onset: boolean
  /** Verdict for each expected chord step (index 0 = current step); null = that step is not a chord. */
  verdicts: readonly (ChordVerdict | null)[]
  heard: string | null
}

const MATCH_FRAMES = 2
const WRONG_FRAMES = 3
/** A decision must come within this long after the strum. */
const WINDOW_MS = 700
/**
 * The analysis slice still contains the previous chord for a while after a strum. Measured on a
 * recording: deciding earlier let the previous chord's ringing pass for the next chord.
 */
const SETTLE_MS = 100
/**
 * A chord is only called wrong once the strum has settled: in the first ~0.15 s the attack hides
 * some notes, which made correct chords look like others (measured: D → "Dsus2", G → "G7").
 */
const WRONG_SETTLE_MS = 250

export class ChordRecognizer {
  private strumTime = -Infinity
  private strumId = 0
  private decided = true
  private matchRun: number[] = []
  private wrongRun = 0

  push(frame: ChordFrame): ChordEvent[] {
    if (frame.onset) {
      this.strumTime = frame.time
      this.strumId++
      this.decided = false
      this.matchRun = frame.verdicts.map(() => 0)
      this.wrongRun = 0
    }
    const since = frame.time - this.strumTime
    if (this.decided || since > WINDOW_MS) return []

    // Decide only once the slice is mostly the new strum (not the previous chord still ringing).
    const settled = since >= SETTLE_MS
    for (let step = 0; step < frame.verdicts.length; step++) {
      this.matchRun[step] = settled && frame.verdicts[step] === 'match' ? (this.matchRun[step] ?? 0) + 1 : 0
      if (this.matchRun[step] >= MATCH_FRAMES) {
        this.decided = true
        return [{ type: 'chordStart', strumId: this.strumId, step, time: frame.time }]
      }
    }
    const current = frame.verdicts[0]
    this.wrongRun = current === 'other' && since >= WRONG_SETTLE_MS ? this.wrongRun + 1 : 0
    if (this.wrongRun >= WRONG_FRAMES) {
      this.decided = true
      return [{ type: 'chordWrong', strumId: this.strumId, heard: frame.heard, time: frame.time }]
    }
    return []
  }

  /** Forget the current strum (e.g. after moving to another step). */
  reset() {
    this.decided = true
  }
}
