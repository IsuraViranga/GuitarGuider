// Chord checking by "chroma" (pitch-class profile): the sound is split into frequencies (FFT) and
// the energy of each of the 12 note names (C, C#, … B) is added up, whatever the octave. A strummed
// chord gives a typical profile; it is compared with what each chord should look like, including
// the overtones every guitar string adds. Because the app knows which chord is expected, it only has
// to decide "is the expected chord the best match?" instead of recognising any chord from scratch.

/** Samples analysed for chords: ~0.17 s at 48 kHz, enough to separate neighbouring low notes. */
export const CHORD_FRAME_SIZE = 8192

const MIN_HZ = 70
const MAX_HZ = 2500
/** Overtones included in each chord's expected profile, with their typical relative strength. */
const HARMONIC_WEIGHTS = [1, 0.6, 0.4, 0.3, 0.2, 0.15]

export type Chroma = Float64Array // 12 values, C = 0 … B = 11, normalised to length 1

/**
 * Real FFT magnitudes via an in-place radix-2 complex FFT (sizes must be powers of two). `size`
 * samples are windowed; with a larger `fftSize` they are padded with zeros, which gives finer
 * frequency steps (used to measure overtones precisely, see stringCheck.ts).
 */
export function createSpectrum(size: number, fftSize = size) {
  const levels = Math.log2(fftSize)
  if (!Number.isInteger(levels) || !Number.isInteger(Math.log2(size)) || fftSize < size) throw new Error('FFT size must be a power of two.')
  const window = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))) // Hann
  const reverse = new Uint32Array(fftSize)
  for (let i = 0; i < fftSize; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r = (r << 1) | ((i >> b) & 1)
    reverse[i] = r
  }
  const cos = new Float64Array(fftSize / 2).map((_, i) => Math.cos((2 * Math.PI * i) / fftSize))
  const sin = new Float64Array(fftSize / 2).map((_, i) => -Math.sin((2 * Math.PI * i) / fftSize))
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const magnitudes = new Float64Array(fftSize / 2)

  return (samples: Float32Array): Float64Array => {
    for (let i = 0; i < fftSize; i++) {
      re[reverse[i]] = i < size ? samples[i] * window[i] : 0
      im[reverse[i]] = 0
    }
    for (let width = 2; width <= fftSize; width *= 2) {
      const half = width / 2
      const step = fftSize / width
      for (let start = 0; start < fftSize; start += width) {
        for (let k = 0; k < half; k++) {
          const a = start + k
          const b = a + half
          const tr = re[b] * cos[k * step] - im[b] * sin[k * step]
          const ti = re[b] * sin[k * step] + im[b] * cos[k * step]
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
    for (let k = 0; k < fftSize / 2; k++) magnitudes[k] = Math.hypot(re[k], im[k])
    return magnitudes
  }
}

function normalise(values: Float64Array): Float64Array {
  const length = Math.hypot(...values)
  return length > 0 ? values.map((v) => v / length) : values
}

/** Pitch-class profile of a frame. Each frequency bin counts towards its nearest note name. */
export function createChromaAnalyser(sampleRate: number, size = CHORD_FRAME_SIZE) {
  const spectrum = createSpectrum(size)
  const binHz = sampleRate / size
  const first = Math.ceil(MIN_HZ / binHz)
  const last = Math.min(size / 2 - 1, Math.floor(MAX_HZ / binHz))
  // Precompute each bin's note name and weight (1 at the note's centre, 0 halfway to the next).
  const binClass = new Uint8Array(last + 1)
  const binWeight = new Float64Array(last + 1)
  for (let k = first; k <= last; k++) {
    const midi = 69 + 12 * Math.log2((k * binHz) / 440)
    const nearest = Math.round(midi)
    binClass[k] = ((nearest % 12) + 12) % 12
    binWeight[k] = Math.cos(Math.PI * (midi - nearest)) ** 2
  }
  return (samples: Float32Array): Chroma => {
    const magnitudes = spectrum(samples.length === size ? samples : samples.subarray(samples.length - size))
    const chroma = new Float64Array(12)
    for (let k = first; k <= last; k++) chroma[binClass[k]] += binWeight[k] * Math.sqrt(magnitudes[k])
    return normalise(chroma)
  }
}

/** The profile a set of notes (MIDI) should produce, overtones included. */
export function chordTemplate(midis: readonly number[]): Chroma {
  const template = new Float64Array(12)
  for (const midi of midis) {
    HARMONIC_WEIGHTS.forEach((weight, h) => {
      const overtone = midi + 12 * Math.log2(h + 1)
      template[((Math.round(overtone) % 12) + 12) % 12] += weight
    })
  }
  return normalise(template)
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const QUALITIES: Array<[string, number[]]> = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['m7', [0, 3, 7, 10]], ['maj7', [0, 4, 7, 11]],
  ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]], ['dim', [0, 3, 6]],
]
/** Every common chord, voiced in a typical guitar range, for "which chord was it really?". */
const COMMON_CHORDS = NAMES.flatMap((name, root) =>
  QUALITIES.map(([suffix, intervals], rank) => ({
    name: name + suffix,
    /** Lower = more common (major, minor first), used to prefer the everyday name. */
    rank,
    classes: new Set(intervals.map((i) => (root + i) % 12)),
    template: chordTemplate(intervals.map((i) => 48 + root + i)),
  })),
)

function similarity(a: Chroma, b: Chroma): number {
  let dot = 0
  for (let i = 0; i < 12; i++) dot += a[i] * b[i]
  return dot
}

export type ChordScore = {
  /** How well the sound matches the expected chord (0–1). */
  expected: number
  /** The best-matching chord that is genuinely different (not the expected chord plus/minus a note). */
  other: { name: string; score: number }
}

/** Compares a profile with the expected chord and with every other common chord. */
export function scoreChord(chroma: Chroma, expectedMidis: readonly number[]): ChordScore {
  const expectedClasses = new Set(expectedMidis.map((m) => ((m % 12) + 12) % 12))
  const expected = similarity(chroma, chordTemplate(expectedMidis))
  let other = { name: '', score: 0 }
  for (const chord of COMMON_CHORDS) {
    // Close relatives are not "a different chord": the same notes plus an added one (C → Cmaj7,
    // which guitar overtones naturally hint at) or minus one (a string not sounding).
    const contains = [...expectedClasses].every((c) => chord.classes.has(c))
    const within = [...chord.classes].every((c) => expectedClasses.has(c))
    if (contains || within) continue
    const score = similarity(chroma, chord.template)
    if (score > other.score) other = { name: chord.name, score }
  }
  return { expected, other }
}

// ---------------------------------------------------------------------------------------------
// Note-by-note chord check: is each expected note name clearly sounding, and nothing foreign?

/** Strings' own notes sound below this; higher up, overtones dominate. */
const NOTE_BAND_HZ: [number, number] = [75, 700]
/** Foreign notes are only looked for below this (the bass string's 5th overtone starts at ~412 Hz). */
const FOREIGN_BAND_MAX_HZ = 350

export type ChordCheck = {
  /** Strength of each note name (C … B) relative to the background, strongest octave. */
  salience: Float64Array
  /** Strength of each note name counting only low notes (for spotting foreign notes). */
  lowSalience: Float64Array
  /**
   * Absolute loudness of each note name (strongest peak), and of low notes only. Used to tell
   * whether a strum made a note louder: relative strength drops right after a strum because the
   * attack briefly raises the background.
   */
  level: Float64Array
  lowLevel: Float64Array
}

export function createChordChecker(sampleRate: number, size = CHORD_FRAME_SIZE) {
  const spectrum = createSpectrum(size)
  const binHz = sampleRate / size
  const bandFirst = Math.max(2, Math.ceil(NOTE_BAND_HZ[0] / binHz))
  const bandLast = Math.floor(NOTE_BAND_HZ[1] / binHz)
  const scratch = new Float64Array(bandLast - bandFirst + 1)

  return (samples: Float32Array): ChordCheck => {
    const magnitudes = spectrum(samples.length === size ? samples : samples.subarray(samples.length - size))
    for (let k = bandFirst; k <= bandLast; k++) scratch[k - bandFirst] = magnitudes[k]
    const floor = [...scratch].sort((a, b) => a - b)[scratch.length >> 1] || 1e-9
    const salience = new Float64Array(12)
    const lowSalience = new Float64Array(12)
    const level = new Float64Array(12)
    const lowLevel = new Float64Array(12)
    // Only real peaks count (local maxima), located between bins by parabolic interpolation, so
    // a strong note's spread into neighbouring bins is not mistaken for the neighbouring note.
    for (let k = bandFirst; k <= bandLast; k++) {
      const m = magnitudes[k]
      if (m <= magnitudes[k - 1] || m < magnitudes[k + 1]) continue
      const a = magnitudes[k - 1]
      const c = magnitudes[k + 1]
      const curvature = a - 2 * m + c
      const offset = curvature < 0 ? (0.5 * (a - c)) / curvature : 0
      const hz = (k + offset) * binHz
      const midi = 69 + 12 * Math.log2(hz / 440)
      const nearest = Math.round(midi)
      if (Math.abs(midi - nearest) > 0.35) continue // between notes: not a guitar note
      const pitchClass = ((nearest % 12) + 12) % 12
      const strength = m / floor
      salience[pitchClass] = Math.max(salience[pitchClass], strength)
      level[pitchClass] = Math.max(level[pitchClass], m)
      if (hz <= FOREIGN_BAND_MAX_HZ) {
        lowSalience[pitchClass] = Math.max(lowSalience[pitchClass], strength)
        lowLevel[pitchClass] = Math.max(lowLevel[pitchClass], m)
      }
    }
    return { salience, lowSalience, level, lowLevel }
  }
}

/** A note name counts as sounding when its peak is at least this many times the background. */
const PRESENT = 4
/** A non-chord note this strong (relative to the chord's notes) means a different chord. */
const FOREIGN_RATIO = 0.15

export type ChordVerdict = 'match' | 'other' | 'unclear'

/** A foreign note only counts if the strum made it at least this much louder (else it is ringing on). */
const FOREIGN_RISE = 1.5
/** The expected chord's notes must get at least this much louder with the strum. */
const EXPECTED_RISE = 1.3

/**
 * Decides whether a frame sounds like the expected chord, another chord, or nothing clear.
 * `before` is the check from just before the strum: notes still ringing from the previous chord
 * (they get quieter, not louder) are not counted as foreign.
 */
export function verifyChord(check: ChordCheck, expectedMidis: readonly number[], before?: ChordCheck | null): ChordVerdict {
  const expected = new Set(expectedMidis.map((m) => ((m % 12) + 12) % 12))
  return judgeClasses(check, expected, before)
}

function judgeClasses(check: ChordCheck, expected: ReadonlySet<number>, before?: ChordCheck | null): ChordVerdict {
  const strongestExpected = Math.max(...[...expected].map((c) => check.lowSalience[c]), ...[...expected].map((c) => check.salience[c] * 0.5))
  let foreign = 0
  for (let c = 0; c < 12; c++) {
    if (expected.has(c)) continue
    if (before && check.lowLevel[c] < before.lowLevel[c] * FOREIGN_RISE) continue // ringing on
    foreign = Math.max(foreign, check.lowSalience[c])
  }
  const missing = [...expected].filter((c) => check.salience[c] < PRESENT).length
  // The strum must bring the chord in: at least half its notes louder than just before the strum.
  // (Otherwise the previous chord's ringing notes and overtones could pass for a related chord.)
  const risen = before ? [...expected].filter((c) => check.level[c] >= before.level[c] * EXPECTED_RISE).length : expected.size
  const broughtIn = risen >= Math.ceil(expected.size / 2)
  const allowedMissing = expected.size >= 4 ? 1 : 0 // e.g. a 7th chord with its 5th not ringing
  const loudest = Math.max(...check.salience)

  if (missing <= allowedMissing && broughtIn && foreign < FOREIGN_RATIO * strongestExpected) return 'match'
  if (loudest >= PRESENT * 2 && (missing > allowedMissing || foreign >= 0.5 * strongestExpected)) return 'other'
  return 'unclear'
}

/**
 * The chord that was actually heard, named if it is a common one (for "heard G" feedback):
 * the common chord that passes the same check as the expected chord would, preferring triads.
 */
export function heardChordName(check: ChordCheck, before?: ChordCheck | null): string | null {
  if (Math.max(...check.salience) < PRESENT * 2) return null
  let best: { name: string; size: number; rank: number } | null = null
  for (const chord of COMMON_CHORDS) {
    if (judgeClasses(check, chord.classes, before) !== 'match') continue
    // Fewest notes that explain the sound, then the most common kind (C before Csus2).
    const better = !best || chord.classes.size < best.size || (chord.classes.size === best.size && chord.rank < best.rank)
    if (better) best = { name: chord.name, size: chord.classes.size, rank: chord.rank }
  }
  return best?.name ?? null
}
