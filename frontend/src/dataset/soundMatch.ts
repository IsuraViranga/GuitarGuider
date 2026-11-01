// Sound match (admin test, with the dataset collector): tells same-note places apart (10 and 25
// are both E4) by comparing a pluck with recordings of the same guitar at both places.
//
// Each pluck becomes a fingerprint: the strengths of its first overtones, the balance of odd and
// even overtones, its stiffness and how regular its overtones are, all measured 200 ms after the
// pluck like the string check (audio/stringCheck.ts). A pluck is said to be at another place only
// when it is clearly closer to that place's recordings than to the expected place's, and only
// for pairs this guitar's recordings themselves keep apart (a self-test: every recording of the
// pair is clearly closer to the other recordings of its own place). Where the recordings of two
// places overlap, nothing is said. Measured on the client's dataset (2 guitars, 3 plucks per
// place, each pluck judged against the other two): on one guitar the wrong places caught went
// from 71% (stiffness check alone) to 91% with no correct pluck called wrong; on the other the
// recordings overlap and the self-test switched every pair off.

import { PitchTracker } from '../audio/pitchTracker'
import { HARMONICS_MEASURED, STIFFNESS_WINDOW, type Stiffness, type StringVerdict } from '../audio/stringCheck'
import { positionsForMidi, positionToMidi } from '../music/fretboard'
import type { GuitarPosition } from '../music/guitarNumber'
import { STANDARD_TUNING, type Tuning } from '../music/tuning'

/** Overtone strengths, odd/even balance, log stiffness, misfit. */
export const FINGERPRINT_SIZE = HARMONICS_MEASURED + 3
/** A pair is checked only when each of its recordings is this much closer to its own place... */
export const SELF_TEST_MARGIN = 1.2
/** ...and a pluck is at the other place only when it is this much closer to it. */
export const DECISION_MARGIN = 1.2
/** Places compared (the dataset covers frets 0–7). */
export const MAX_MATCHED_FRET = 7

export type Fingerprint = number[]
export type Reference = { stringNumber: GuitarPosition['stringNumber']; fret: number; v: Fingerprint }

/** A pluck's fingerprint, or null when it could not be measured. */
export function fingerprint(stiffness: Stiffness | null | undefined): Fingerprint | null {
  const levels = stiffness?.harmonics
  if (!stiffness || !levels || levels.length !== HARMONICS_MEASURED) return null
  let odd = 0
  let even = 0
  levels.forEach((level, i) => {
    if (i % 2 === 0) odd += 10 ** (level / 10)
    else even += 10 ** (level / 10)
  })
  return [...levels, 10 * Math.log10(odd / Math.max(even, 1e-18)), Math.log(Math.max(stiffness.b, 1e-7)), stiffness.misfit]
}

export type SoundMatch = {
  /** The other places of this note that this guitar's recordings keep apart from it. */
  pairsOn: (position: GuitarPosition) => GuitarPosition[]
  /** The other place the pluck was clearly played at, or null (expected place, or not sure). */
  judge: (expected: GuitarPosition, pluck: Fingerprint) => GuitarPosition | null
}

const key = (p: { stringNumber: number; fret: number }) => `${p.stringNumber}-${p.fret}`

/** The other places of the same note, up to MAX_MATCHED_FRET (none above it). */
export function sameNotePlaces(position: GuitarPosition, tuning: Tuning = STANDARD_TUNING): GuitarPosition[] {
  if (position.fret > MAX_MATCHED_FRET) return []
  return positionsForMidi(positionToMidi(position, tuning), tuning).filter((p) => p.stringNumber !== position.stringNumber && p.fret <= MAX_MATCHED_FRET)
}

/** How many same-note pairs (up to MAX_MATCHED_FRET) the guitar's recordings keep apart. */
export function countPairs(match: SoundMatch | null, tuning: Tuning = STANDARD_TUNING): { on: number; total: number } {
  let on = 0
  let total = 0
  for (const stringNumber of [1, 2, 3, 4, 5, 6] as const) {
    for (let fret = 0; fret <= MAX_MATCHED_FRET; fret++) {
      const position = { stringNumber, fret }
      const kept = match?.pairsOn(position) ?? []
      for (const other of sameNotePlaces(position, tuning)) {
        if (key(other) < key(position)) continue // each pair once
        total++
        if (kept.some((p) => key(p) === key(other))) on++
      }
    }
  }
  return { on, total }
}

export function createSoundMatch(references: readonly Reference[], tuning: Tuning = STANDARD_TUNING): SoundMatch | null {
  const usable = references.filter((r) => r.v.length === FINGERPRINT_SIZE && r.v.every(Number.isFinite))
  if (usable.length === 0) return null
  // Each number scaled by how much it varies on this guitar.
  const centre: number[] = []
  const spread: number[] = []
  for (let d = 0; d < FINGERPRINT_SIZE; d++) {
    const values = usable.map((r) => r.v[d]).sort((a, b) => a - b)
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    centre.push(values[values.length >> 1])
    spread.push(Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length) + 1e-9)
  }
  const scale = (v: Fingerprint) => v.map((x, d) => (x - centre[d]) / spread[d])
  const at = new Map<string, number[][]>()
  for (const r of usable) at.set(key(r), [...(at.get(key(r)) ?? []), scale(r.v)])
  const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, x, d) => sum + (x - b[d]) ** 2, 0))
  const nearest = (z: number[], list: number[][]) => Math.min(...list.map((other) => distance(z, other)))

  // Self-test: every recording of each place, left out, must be clearly closer to its own place.
  const keptApart = new Map<string, boolean>()
  const passes = (a: GuitarPosition, b: GuitarPosition) => {
    const pair = [key(a), key(b)].sort().join('|')
    let result = keptApart.get(pair)
    if (result === undefined) {
      const ra = at.get(key(a)) ?? []
      const rb = at.get(key(b)) ?? []
      const apart = (own: number[][], other: number[][]) =>
        own.every((z, i) => {
          const rest = own.filter((_, j) => j !== i)
          return rest.length > 0 && nearest(z, other) > SELF_TEST_MARGIN * nearest(z, rest)
        })
      result = ra.length >= 2 && rb.length >= 2 && apart(ra, rb) && apart(rb, ra)
      keptApart.set(pair, result)
    }
    return result
  }
  const pairsOn = (position: GuitarPosition) => sameNotePlaces(position, tuning).filter((q) => passes(position, q))

  return {
    pairsOn,
    judge(expected, pluck) {
      const own = at.get(key(expected))
      if (!own || pluck.length !== FINGERPRINT_SIZE) return null
      const z = scale(pluck)
      const fromExpected = nearest(z, own)
      let best: { position: GuitarPosition; d: number } | null = null
      for (const other of pairsOn(expected)) {
        const d = nearest(z, at.get(key(other))!)
        if (d * DECISION_MARGIN < fromExpected && (!best || d < best.d)) best = { position: other, d }
      }
      return best?.position ?? null
    },
  }
}

/**
 * Practice: the verdict after the string check. Where the check is unsure or did not plan for
 * this note, the sound match may name another place; a clear verdict of the check is kept.
 */
export function withSoundMatch(
  match: SoundMatch | null,
  expected: GuitarPosition | null,
  stiffness: Stiffness | null | undefined,
  verdict: StringVerdict | undefined,
): StringVerdict | undefined {
  if (!match || !expected || stiffness === undefined || (verdict && verdict.result !== 'unsure')) return verdict
  const pluck = fingerprint(stiffness)
  const heard = pluck && match.judge(expected, pluck)
  return heard ? { result: 'other', heard } : verdict
}

/**
 * A recording of one pluck through the live tracker, as practice hears it: the expected note is
 * the target, and the measurement is the one practice would judge (null: not heard or measured).
 */
export function measureRecording(samples: Float32Array, sampleRate: number, midi: number): Stiffness | null {
  const tracker = new PitchTracker(sampleRate, 2048)
  tracker.resetNotes({ requireFreshOnset: true })
  tracker.setTargets([midi])
  tracker.setStiffnessProbe(midi)
  const hop = Math.round(0.025 * sampleRate)
  for (let end = STIFFNESS_WINDOW; end <= samples.length; end += hop) {
    for (const event of tracker.process(samples.subarray(end - STIFFNESS_WINDOW, end), (end / sampleRate) * 1000).events) {
      if (event.type === 'noteStart' && event.stiffness) return event.stiffness
    }
  }
  return null
}
