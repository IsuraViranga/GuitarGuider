// String check: which string a note was played on, told from its sound.
//
// The same note can often be played on two or three strings (10 and 25 are both E4), so pitch
// alone cannot tell them apart. Their overtones can: a guitar string is slightly stiff, so its
// overtones are a little sharp of exact multiples of the note ("inharmonicity" B):
//
//   overtone k = k · f0 · √(1 + B·k²)
//
// B depends on the string's thickness, tension and the length that vibrates, so it differs per
// string, and on one string it doubles every 6 frets (the vibrating part gets shorter):
//
//   B(string, fret) = B(string, open) · 2^(fret / 6)
//
// After B is measured once on each open string (guitar setup), the app predicts B for every
// position and compares it with the B of the note just played. Measured on the client's phone
// recordings (×10⁻⁵): 10 → 1.7, 25 → 7.7, 13 → 2.4, 28 → 11, every pluck within a few percent,
// and as predicted from the open strings. Strings whose predictions are too close (often a plain
// string next to a wound one, e.g. 20 and 34 on that guitar) are never judged, and the check only
// says "another string" when it is clearly sure; otherwise the note counts as before.

import { formatGuitarNumber, type GuitarPosition } from '../music/guitarNumber'
import { positionToMidi, positionsForMidi } from '../music/fretboard'
import type { StringNumber, Tuning } from '../music/tuning'
import { createSpectrum } from './chroma'

/** Samples measured: the newest 8192 (≈170 ms at 48 kHz), the live listener's longer slice. */
export const STIFFNESS_WINDOW = 8192
/** Zero-padded FFT size: fine frequency steps for exact overtone positions. */
const FFT_SIZE = 65536
/**
 * A note's stiffness is measured this long after its pluck, on the last STIFFNESS_WINDOW samples
 * (≈30–200 ms after the pluck at 48 kHz: past the attack, before the overtones fade).
 */
export const STRING_CHECK_DELAY_MS = 200
/** Overtones looked for (the first 25 are clearly present on a phone recording). */
const MAX_OVERTONES = 25
/** An overtone counts only when it stands out this much above the noise floor. */
const MIN_PEAK_OVER_NOISE = 20
/** Fewer overtones than this: no measurement. */
const MIN_OVERTONES_MEASURED = 6

export type Stiffness = {
  /** Inharmonicity coefficient B (about 0.00001–0.0002 on a guitar). */
  b: number
  /** How many overtones the measurement used (more = more reliable). */
  overtones: number
  /** Typical distance of the overtones from the fitted curve, in cents (small = clean). */
  misfit: number
}

/**
 * Measures B of the note in `samples` (the newest STIFFNESS_WINDOW are used), near `f0` (Hz).
 * Each overtone is found where it is expected, and the line (f_k / k)² = f0² + f0²·B·k² is fitted
 * robustly (median of slopes), so one wrongly found overtone cannot spoil the result.
 * Returns null when too few overtones are clear.
 */
export function createStiffnessMeter(sampleRate: number) {
  const spectrum = createSpectrum(STIFFNESS_WINDOW, FFT_SIZE)
  const binHz = sampleRate / FFT_SIZE
  const sorted = new Float64Array(FFT_SIZE / 2)

  return (samples: Float32Array, f0: number): Stiffness | null => {
    if (samples.length < STIFFNESS_WINDOW || !(f0 > 0)) return null
    const magnitudes = spectrum(samples.subarray(samples.length - STIFFNESS_WINDOW))
    sorted.set(magnitudes)
    sorted.sort()
    const noise = sorted[sorted.length >> 1]
    const found: Array<[number, number]> = [] // [overtone number, measured frequency]
    let fitted: { b: number; f0: number } = { b: 0, f0 }
    for (let k = 1; k <= MAX_OVERTONES; k++) {
      const expected = k * fitted.f0 * Math.sqrt(1 + fitted.b * k * k)
      const low = Math.floor((expected - 0.15 * f0) / binHz)
      const high = Math.ceil((expected + 0.15 * f0) / binHz)
      if (low < 1 || high >= magnitudes.length - 1) break
      let peak = low
      for (let i = low + 1; i <= high; i++) if (magnitudes[i] > magnitudes[peak]) peak = i
      if (peak === low || peak === high || magnitudes[peak] < MIN_PEAK_OVER_NOISE * noise) continue
      found.push([k, (peak + parabolicOffset(magnitudes, peak)) * binHz])
      if (found.length >= 5) fitted = fitLine(found) ?? fitted
    }
    if (found.length < MIN_OVERTONES_MEASURED) return null
    const result = fitLine(found)
    if (!result) return null
    // How far the overtones lie from the fitted curve: a clean pluck of one string fits within a
    // cent or two; another string ringing along, or a buzzing fret, does not.
    const misfit = median(found.map(([k, f]) => Math.abs(1200 * Math.log2(f / (k * result.f0 * Math.sqrt(1 + result.b * k * k))))))
    return { b: result.b, overtones: found.length, misfit }
  }
}

/** Where the true peak lies between bins (on a log scale, which suits the Hann window's peak). */
function parabolicOffset(magnitudes: Float64Array, i: number): number {
  const a = Math.log(magnitudes[i - 1] + 1e-12)
  const b = Math.log(magnitudes[i] + 1e-12)
  const c = Math.log(magnitudes[i + 1] + 1e-12)
  const curve = a - 2 * b + c
  return curve === 0 ? 0 : (0.5 * (a - c)) / curve
}

/** Robust straight line through (k², (f_k / k)²): the median of slopes between well-separated pairs. */
function fitLine(found: ReadonlyArray<[number, number]>): { b: number; f0: number } | null {
  const xs = found.map(([k]) => k * k)
  const ys = found.map(([k, f]) => (f / k) ** 2)
  const slopes: number[] = []
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) if (xs[j] - xs[i] >= 9) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]))
  }
  if (slopes.length === 0) return null
  const slope = median(slopes)
  const intercept = median(ys.map((y, i) => y - slope * xs[i]))
  if (!(intercept > 0)) return null
  return { b: slope / intercept, f0: Math.sqrt(intercept) }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** B of each open string, measured in the guitar setup. Strings that were skipped are missing. */
export type OpenStringStiffness = Partial<Record<StringNumber, number>>

/**
 * What the guitar setup learned: each open string's B, and how regular its overtones normally are
 * (its usual misfit, in cents). Plain strings fit their curve within a fraction of a cent; wound
 * strings less well (measured on a real guitar: string 3 about 2.5, string 6 about 2 cents), but
 * each string the same way every time. Setups saved before the misfit was learned have none.
 */
export type GuitarStrings = {
  open: OpenStringStiffness
  misfit?: Partial<Record<StringNumber, number>>
}

/** The predicted B at a position, or null when its string was not measured. */
export function predictStiffness(open: OpenStringStiffness, position: GuitarPosition): number | null {
  const b = open[position.stringNumber]
  return b === undefined ? null : b * 2 ** (position.fret / 6)
}

/**
 * Two positions can be told apart only when their predicted B differ at least this much (the
 * ratio is the same at every fret for a pair of strings). Measured spread per position is a few
 * percent, so this leaves a wide safety margin.
 */
export const CHECKABLE_RATIO = 2.5
/** A measurement this close (ratio) to a position's prediction matches it... */
const MATCH_RATIO = 1.6
/** ...and the expected position is ruled out only when the measurement is at least this far from it. */
const RULED_OUT_RATIO = 2.2
/** "Another string" is only said on a measurement with at least this many overtones... */
const MIN_OVERTONES_TO_JUDGE = 12
/**
 * ...and any judgement only on a clean one: a pluck whose overtones fit about as well as that
 * string's do in the setup (up to 1.4× its usual misfit), never worse than MAX_STRING_MISFIT.
 * Without a learned value (older setups): MAX_MISFIT_CENTS, which suits plain strings.
 */
export const MAX_MISFIT_CENTS = 1.5
const USUAL_MISFIT_ALLOWANCE = 1.4
/**
 * Never trusted above this. Measured on real recordings: clean plucks of every string 0.1–3.0
 * cents (string 3 the least regular), plucks disturbed by another ringing string or a buzz 3.9–11.
 */
export const MAX_STRING_MISFIT = 3.5

/** The largest misfit a pluck on this string may have to be judged. */
export function misfitLimit(strings: GuitarStrings, string: StringNumber): number {
  const usual = strings.misfit?.[string]
  if (usual === undefined) return MAX_MISFIT_CENTS
  return Math.min(MAX_STRING_MISFIT, Math.max(MAX_MISFIT_CENTS, usual * USUAL_MISFIT_ALLOWANCE))
}

type Candidate = {
  position: GuitarPosition
  predicted: number
  /** A pluck on this string is judged only up to this misfit (see misfitLimit). */
  maxMisfit: number
}

export type StringCheck = {
  expected: Candidate
  /** The same note on other strings that this guitar's setup can tell apart from `expected`. */
  others: Candidate[]
}

/**
 * What to check for a note at `position`: null when nothing can be checked (no other string has
 * this note up to fret 12, its strings were not measured, or they sound too alike).
 */
export function planStringCheck(position: GuitarPosition, strings: GuitarStrings, tuning: Tuning, maxFret = 12): StringCheck | null {
  const predicted = predictStiffness(strings.open, position)
  if (predicted === null) return null
  const others = positionsForMidi(positionToMidi(position, tuning), tuning)
    .filter((p) => p.stringNumber !== position.stringNumber && p.fret <= maxFret)
    .flatMap((p) => {
      const b = predictStiffness(strings.open, p)
      return b !== null && ratio(b, predicted) >= CHECKABLE_RATIO ? [{ position: p, predicted: b, maxMisfit: misfitLimit(strings, p.stringNumber) }] : []
    })
  const expected = { position, predicted, maxMisfit: misfitLimit(strings, position.stringNumber) }
  return others.length > 0 ? { expected, others } : null
}

export type StringVerdict =
  | { result: 'expected' }
  | { result: 'unsure' }
  /** Clearly another string: the note was played at `heard`. */
  | { result: 'other'; heard: GuitarPosition }

/** Judges a played note's measured stiffness (null = no measurement) against the plan. */
export function judgeString(check: StringCheck, stiffness: Stiffness | null): StringVerdict {
  if (!stiffness || !(stiffness.b > 0)) return { result: 'unsure' }
  const fromExpected = ratio(stiffness.b, check.expected.predicted)
  if (fromExpected <= MATCH_RATIO) return isClean(stiffness, check.expected.maxMisfit) ? { result: 'expected' } : { result: 'unsure' }
  if (stiffness.overtones < MIN_OVERTONES_TO_JUDGE || fromExpected < RULED_OUT_RATIO) return { result: 'unsure' }
  const nearest = [...check.others].sort((a, b) => ratio(stiffness.b, a.predicted) - ratio(stiffness.b, b.predicted))[0]
  // The played string must fit as cleanly as that string normally does.
  return ratio(stiffness.b, nearest.predicted) <= MATCH_RATIO && isClean(stiffness, nearest.maxMisfit)
    ? { result: 'other', heard: nearest.position }
    : { result: 'unsure' }
}

/** A measurement good enough to rely on: positive B, overtones within `maxMisfit` cents of the curve. */
export function isClean(stiffness: Stiffness | null, maxMisfit = MAX_MISFIT_CENTS): stiffness is Stiffness {
  return stiffness !== null && stiffness.b > 0 && stiffness.misfit <= maxMisfit
}

/** How many times larger the larger value is (always ≥ 1). */
function ratio(a: number, b: number): number {
  return a > b ? a / b : b / a
}

/** For logs: "25" style label of a verdict's position. */
export function verdictLabel(verdict: StringVerdict): string {
  return verdict.result === 'other' ? `other:${formatGuitarNumber(verdict.heard)}` : verdict.result
}
