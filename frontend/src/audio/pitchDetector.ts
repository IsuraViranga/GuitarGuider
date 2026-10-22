// YIN pitch detection (de Cheveigné & Kawahara, 2002).
//
// Idea in plain words: a note is a wave that repeats. YIN slides a copy of the sound
// against itself and measures how different it is at each shift ("lag"). The first lag
// where the copy lines up almost perfectly is one period of the note; 1 / period = pitch.
// How perfectly it lines up gives a confidence value ("clarity", 0–1).
// Noise never lines up well, so it gets low clarity and is ignored later.

export type PitchFrame = {
  /** Estimated fundamental frequency in Hz, or null when no period was found. */
  frequency: number | null
  /** 0–1. How periodic the sound is; clean guitar notes are usually above 0.9. */
  clarity: number
  /** Loudness of the frame (root mean square of the samples). */
  rms: number
}

export type YinOptions = {
  /** Lowest pitch searched. Low E (string 6) is 82.4 Hz; 70 Hz leaves room for flat tuning. */
  minFrequency: number
  /** Highest pitch searched. String 1, fret 24 is 1318.5 Hz. */
  maxFrequency: number
  /** A lag counts as "lined up" when its normalised difference is below this. */
  threshold: number
}

export const DEFAULT_YIN_OPTIONS: YinOptions = {
  minFrequency: 70,
  maxFrequency: 1400,
  threshold: 0.15,
}

/** How well the last analysed frame repeats at one particular pitch. */
export type PitchMatch = {
  /** 0–1, like clarity: near 1 means the sound clearly contains this pitch. */
  strength: number
  /** The exact frequency of the match (within the searched window). */
  frequency: number
}

export type PitchDetector = {
  (samples: Float32Array): PitchFrame
  /**
   * Checks the last analysed frame for one expected pitch (±`cents`). Used when the app knows
   * which note should be played: with two strings ringing, the blended sound may not give a
   * clear single pitch, but the expected note is still clearly present. Null if there is no
   * dip (local best match) near that pitch.
   */
  matchAt(frequency: number, cents?: number): PitchMatch | null
}

/** Only re-check the octave when the chosen dip is not already near-perfect. */
const OCTAVE_CHECK_MIN = 0.04
/** Double the period is chosen only if it lines up at least this much better (2×)... */
const OCTAVE_CHECK_RATIO = 0.5
/**
 * ...and lines up almost perfectly. A single note with a weak fundamental does; two strings
 * ringing together (common when changing strings quickly) do not, and must not be halved.
 */
const OCTAVE_CHECK_MAX = 0.05

/**
 * Creates a detector for frames of `frameSize` samples. Buffers are allocated once and
 * reused, because this runs ~40 times per second on a phone.
 */
export function createPitchDetector(
  sampleRate: number,
  frameSize: number,
  options: YinOptions = DEFAULT_YIN_OPTIONS,
): PitchDetector {
  const maxLag = Math.min(Math.floor(sampleRate / options.minFrequency), Math.floor(frameSize / 2))
  const minLag = Math.max(2, Math.floor(sampleRate / options.maxFrequency))
  const window = frameSize - maxLag
  const difference = new Float32Array(maxLag + 1)
  let analysed = false

  const refine = (lag: number) => {
    if (lag <= minLag || lag >= maxLag) return lag
    const before = difference[lag - 1]
    const at = difference[lag]
    const after = difference[lag + 1]
    const curvature = before + after - 2 * at
    return curvature > 0 ? lag + (0.5 * (before - after)) / curvature : lag
  }

  const detect = (samples: Float32Array): PitchFrame => {
    analysed = false
    let sumOfSquares = 0
    for (let i = 0; i < frameSize; i++) sumOfSquares += samples[i] * samples[i]
    const rms = Math.sqrt(sumOfSquares / frameSize)
    if (rms === 0) return { frequency: null, clarity: 0, rms }

    // Steps 1–3: difference function, then "cumulative mean normalised difference".
    // Normalising makes lag 0 equal 1 and removes the bias towards very short lags.
    difference[0] = 1
    let runningSum = 0
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0
      for (let j = 0; j < window; j++) {
        const delta = samples[j] - samples[j + lag]
        sum += delta * delta
      }
      runningSum += sum
      difference[lag] = runningSum > 0 ? (sum * lag) / runningSum : 1
    }
    analysed = true

    // Step 4: the first dip below the threshold, followed down to its lowest point.
    // Taking the *first* good dip avoids choosing two periods (an octave too low).
    let bestLag = -1
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (difference[lag] < options.threshold) {
        while (lag + 1 <= maxLag && difference[lag + 1] < difference[lag]) lag++
        bestLag = lag
        break
      }
    }
    // No clear dip: report the best lag anyway, with its (low) clarity, for diagnostics.
    if (bestLag === -1) {
      bestLag = minLag
      for (let lag = minLag + 1; lag <= maxLag; lag++) {
        if (difference[lag] < difference[bestLag]) bestLag = lag
      }
    }
    // Octave check: if the fundamental is weak (e.g. a string plucked near the bridge), the
    // first dip can be half the true period, giving a pitch an octave too high. At the true
    // period the sound lines up much better, so prefer double the lag when it is clearly better.
    const doubled = bestLag * 2
    if (difference[bestLag] > OCTAVE_CHECK_MIN && doubled + 2 <= maxLag) {
      let candidate = doubled
      for (let lag = doubled - 2; lag <= doubled + 2; lag++) {
        if (difference[lag] < difference[candidate]) candidate = lag
      }
      if (difference[candidate] < OCTAVE_CHECK_MAX && difference[candidate] < difference[bestLag] * OCTAVE_CHECK_RATIO) {
        bestLag = candidate
      }
    }

    const clarity = Math.max(0, Math.min(1, 1 - difference[bestLag]))

    // Step 5: parabolic interpolation for a period between whole samples (finer pitch).
    return { frequency: sampleRate / refine(bestLag), clarity, rms }
  }

  const matchAt = (frequency: number, cents = 40): PitchMatch | null => {
    if (!analysed) return null
    const shortest = Math.max(minLag, Math.floor(sampleRate / (frequency * 2 ** (cents / 1200))))
    const longest = Math.min(maxLag - 1, Math.ceil(sampleRate / (frequency / 2 ** (cents / 1200))))
    if (shortest > longest) return null
    let lag = shortest
    for (let candidate = shortest + 1; candidate <= longest; candidate++) {
      if (difference[candidate] < difference[lag]) lag = candidate
    }
    // Must be a real dip, not just the low edge of a neighbouring one.
    if (difference[lag - 1] < difference[lag] || difference[lag + 1] < difference[lag]) return null
    return { strength: Math.max(0, 1 - difference[lag]), frequency: sampleRate / refine(lag) }
  }

  return Object.assign(detect, { matchAt })
}
