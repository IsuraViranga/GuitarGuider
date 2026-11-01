import { describe, expect, it } from 'vitest'
import type { Stiffness } from '../audio/stringCheck'
import { countPairs, createSoundMatch, fingerprint, FINGERPRINT_SIZE, fitsSetup, withSoundMatch, type Reference } from './soundMatch'

const P10 = { stringNumber: 1 as const, fret: 0 }
const P25 = { stringNumber: 2 as const, fret: 5 }

/** A measured pluck whose second overtone is `second` dB (the colour that differs); the rest the same. */
const sounding = (second: number): Stiffness => ({ b: 2e-5, overtones: 24, misfit: 0.4, harmonics: [0, second, ...Array.from({ length: 14 }, () => -20)] })
const print = (second: number) => fingerprint(sounding(second))!
/** Three recordings of 10 and of 25 on one guitar: 25's second overtone is much stronger. */
const apart: Reference[] = [
  ...[-12, -11.5, -12.5].map((s) => ({ ...P10, v: print(s) })),
  ...[-2, -2.5, -1.5].map((s) => ({ ...P25, v: print(s) })),
]
/** The same, but the two places sound alike. */
const alike: Reference[] = [
  ...[-6, -8, -4].map((s) => ({ ...P10, v: print(s) })),
  ...[-5, -7, -9].map((s) => ({ ...P25, v: print(s) })),
]

describe('fingerprint of a pluck', () => {
  it('overtone strengths, odd/even balance, log stiffness, misfit', () => {
    const harmonics = [0, -6, ...Array.from({ length: 14 }, () => -30)]
    const v = fingerprint({ b: 2e-5, overtones: 24, misfit: 0.4, harmonics })!
    expect(v).toHaveLength(FINGERPRINT_SIZE)
    expect(v.slice(0, 16)).toEqual(harmonics)
    expect(v[16]).toBeCloseTo(10 * Math.log10((1 + 7 * 10 ** -3) / (10 ** -0.6 + 7 * 10 ** -3)), 6)
    expect(v[17]).toBeCloseTo(Math.log(2e-5), 9)
    expect(v[18]).toBe(0.4)
  })

  it('none without the overtone strengths (or without a measurement)', () => {
    expect(fingerprint({ b: 2e-5, overtones: 24, misfit: 0.4 })).toBeNull()
    expect(fingerprint(null)).toBeNull()
  })
})

describe('comparing a pluck with the guitar recordings', () => {
  it('names the other place only when the pluck is clearly closer to its recordings', () => {
    const match = createSoundMatch(apart)!
    expect(match.pairsOn(P10)).toEqual([P25])
    expect(match.judge(P10, print(-2.2))).toEqual(P25) // sounds like 25
    expect(match.judge(P10, print(-11.8))).toBeNull() // sounds like 10: right
    expect(match.judge(P10, print(-7))).toBeNull() // in between: not sure, nothing said
    expect(match.judge(P25, print(-12))).toEqual(P10)
  })

  it('a pair whose recordings overlap is never judged (self-test)', () => {
    const match = createSoundMatch(alike)!
    expect(match.pairsOn(P10)).toEqual([])
    expect(match.judge(P10, print(-5))).toBeNull()
  })

  it('needs at least two recordings of each place', () => {
    const match = createSoundMatch(apart.filter((r, i) => r.stringNumber === 1 || i === 3))!
    expect(match.pairsOn(P10)).toEqual([])
  })

  it('no usable recordings: no sound match', () => {
    expect(createSoundMatch([])).toBeNull()
    expect(createSoundMatch([{ ...P10, v: [1, 2] }])).toBeNull()
  })

  it('counts the same-note pairs up to fret 7 (16 in standard tuning) and how many are kept apart', () => {
    expect(countPairs(createSoundMatch(apart))).toEqual({ on: 1, total: 16 })
    expect(countPairs(null)).toEqual({ on: 0, total: 16 })
  })
})

describe('after the string check, in practice', () => {
  const match = createSoundMatch(apart)!

  it('keeps a clear verdict of the string check', () => {
    expect(withSoundMatch(match, P10, sounding(-2), { result: 'expected' })).toEqual({ result: 'expected' })
    expect(withSoundMatch(match, P10, sounding(-12), { result: 'other', heard: P25 })).toEqual({ result: 'other', heard: P25 })
  })

  it('where the check is unsure or has no plan, names the place the pluck sounds like', () => {
    expect(withSoundMatch(match, P10, sounding(-2), { result: 'unsure' })).toEqual({ result: 'other', heard: P25 })
    expect(withSoundMatch(match, P10, sounding(-2), undefined)).toEqual({ result: 'other', heard: P25 })
    expect(withSoundMatch(match, P10, sounding(-12), undefined)).toBeUndefined()
  })

  it('does nothing without a measurement, a match or a note', () => {
    expect(withSoundMatch(match, P10, undefined, undefined)).toBeUndefined()
    expect(withSoundMatch(null, P10, sounding(-2), { result: 'unsure' })).toEqual({ result: 'unsure' })
    expect(withSoundMatch(match, null, sounding(-2), undefined)).toBeUndefined()
  })
})

describe('do the recordings fit this guitar? (guitar setup)', () => {
  const OPEN = { 1: 1.7e-5, 2: 4.5e-5, 3: 2.9e-5, 4: 6e-5, 5: 1.2e-4, 6: 1.8e-4 } as Record<number, number>
  /** Three recordings of each open string with stiffness `scale` × OPEN. */
  const recordings = (scale: Record<number, number> = {}): Reference[] =>
    [1, 2, 3, 4, 5, 6].flatMap((s) =>
      [0.97, 1, 1.03].map((k) => ({ stringNumber: s as 1, fret: 0, v: fingerprint({ b: OPEN[s] * k * (scale[s] ?? 1), overtones: 24, misfit: 0.4, harmonics: Array.from({ length: 16 }, () => -10) })! })),
    )

  it('the same guitar fits', () => {
    expect(fitsSetup(recordings(), { open: OPEN })).toBe(true)
    expect(fitsSetup(recordings({ 3: 1.3 }), { open: OPEN })).toBe(true) // within ×1.35
  })

  it('one string clearly different: another guitar (or new strings), not used', () => {
    expect(fitsSetup(recordings({ 3: 1.5 }), { open: OPEN })).toBe(false)
    expect(fitsSetup(recordings({ 1: 0.5 }), { open: OPEN })).toBe(false)
  })

  it('needs at least 5 strings to compare, and a guitar setup', () => {
    const { 5: _a, 6: _b, ...four } = OPEN
    expect(fitsSetup(recordings(), { open: four })).toBe(false)
    const { 6: _c, ...five } = OPEN
    expect(fitsSetup(recordings(), { open: five })).toBe(true)
    expect(fitsSetup(recordings(), null)).toBe(false)
  })
})
