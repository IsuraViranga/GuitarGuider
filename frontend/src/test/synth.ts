// Test-only sound generator. Karplus–Strong synthesis makes a realistic plucked string:
// a burst of noise circulates through a short delay line with a gentle low-pass filter,
// giving a harmonic-rich tone that decays like a real guitar string.

export const SAMPLE_RATE = 48000

/** Small deterministic random generator so tests always hear exactly the same sound. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

export function pluck(
  frequency: number,
  seconds: number,
  { amplitude = 0.3, decay = 0.996, seed = 1, sampleRate = SAMPLE_RATE } = {},
): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate))
  // Averaging the oldest sample with the next one shortens the loop by half a sample,
  // so the delay line is made half a sample longer to compensate.
  const exact = sampleRate / frequency + 0.5
  const length = Math.floor(exact)
  const fraction = exact - length // first-order all-pass tunes the fractional part
  const allpass = (1 - fraction) / (1 + fraction)
  const random = seededRandom(seed)
  const line = new Float32Array(length)
  for (let i = 0; i < length; i++) line[i] = random() * 2 - 1
  let index = 0
  let previousIn = 0
  let previousOut = 0
  let last = line[0]
  for (let i = 0; i < out.length; i++) {
    const current = line[index]
    const next = line[(index + 1) % length]
    const averaged = decay * 0.5 * (current + next)
    const tuned = allpass * averaged + previousIn - allpass * previousOut
    previousIn = averaged
    previousOut = tuned
    line[index] = tuned
    last = current
    out[i] = last * amplitude
    index = (index + 1) % length
  }
  return out
}

/** Sum of harmonics with chosen strengths, e.g. a weak fundamental and strong 2nd harmonic. */
export function harmonics(frequency: number, seconds: number, strengths: number[], amplitude = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  const total = strengths.reduce((a, b) => a + b, 0)
  for (let i = 0; i < out.length; i++) {
    let value = 0
    strengths.forEach((strength, h) => {
      value += strength * Math.sin((2 * Math.PI * frequency * (h + 1) * i) / SAMPLE_RATE)
    })
    out[i] = (value / total) * amplitude
  }
  return out
}

export function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE))
}

export function noise(seconds: number, amplitude: number, seed = 7): Float32Array {
  const random = seededRandom(seed)
  return Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, () => (random() * 2 - 1) * amplitude)
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Adds `b` on top of `a` (same length or shorter). */
export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = Float32Array.from(a)
  for (let i = 0; i < Math.min(a.length, b.length); i++) out[i] += b[i]
  return out
}

export type PlayedNote = { midi: number; stringNumber: number; start: number }

/**
 * A realistic performance: each note is plucked at `start` seconds. Notes on other strings keep
 * ringing underneath (as on a real guitar); plucking a string again stops its previous note.
 */
export function perform(notes: PlayedNote[], seconds: number, { amplitude = 0.3, roomNoise = 0.0008 } = {}): Float32Array {
  const out = noise(seconds, roomNoise, 4242)
  notes.forEach((note, i) => {
    const sameStringNext = notes.slice(i + 1).find((n) => n.stringNumber === note.stringNumber)
    const end = sameStringNext ? sameStringNext.start : seconds
    const length = end - note.start
    if (length <= 0) return
    const tone = pluck(440 * 2 ** ((note.midi - 69) / 12), length, { amplitude, seed: i + 11 })
    const offset = Math.round(note.start * SAMPLE_RATE)
    const fade = Math.round(0.005 * SAMPLE_RATE) // finger stops the string over ~5 ms
    for (let j = 0; j < tone.length && offset + j < out.length; j++) {
      const fadeOut = sameStringNext && j > tone.length - fade ? (tone.length - j) / fade : 1
      out[offset + j] += tone[j] * fadeOut
    }
  })
  return out
}
