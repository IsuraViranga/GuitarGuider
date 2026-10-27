/// <reference types="node" />
// String check measured on the client's own phone recordings of same-note pairs (2026-10-24,
// recordings/same-pitch/, personal and not in git, so these tests are skipped without them).
// Recording 1: 10 ×6, 25 ×6, 20 ×5, 34 ×6. Recording 2: 11 ×5, 26 ×6, 13 ×6, 28 ×5.
// Each recording is replayed through the live tracker with the note expected, as in the app; the
// guitar setup comes from the open-string plucks only (10 and 20), as the setup page would get it.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatGuitarNumber, parseGuitarNumber, type GuitarPosition } from '../music/guitarNumber'
import { STANDARD_TUNING } from '../music/tuning'
import { settledStiffness } from '../practice/stringSetup'
import { PitchTracker } from './pitchTracker'
import { isClean, judgeString, planStringCheck, STIFFNESS_WINDOW, type Stiffness, type StringVerdict } from './stringCheck'
import { decodeWav } from './wav'

const FOLDER = '../recordings/same-pitch'
const RECORDINGS: Record<string, Record<string, [number, number]>> = {
  Recording1: { '10': [0, 30], '25': [30, 55], '20': [55, 80], '34': [80, 103] },
  Recording2: { '11': [0, 20], '26': [20, 40], '13': [40, 60], '28': [60, 85] },
}
const available = Object.keys(RECORDINGS).every((name) => existsSync(`${FOLDER}/${name}.wav`))
const position = (code: string): GuitarPosition => {
  const parsed = parseGuitarNumber(code)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}
const pitchOf = (code: string) => STANDARD_TUNING.openStringMidi[position(code).stringNumber] + position(code).fret

/** Every pluck the tracker reported in each part of the recordings, with its measurement. */
function measureAll(): Record<string, Array<Stiffness | null>> {
  const measured: Record<string, Array<Stiffness | null>> = {}
  for (const [name, parts] of Object.entries(RECORDINGS)) {
    const bytes = readFileSync(`${FOLDER}/${name}.wav`)
    const { samples, sampleRate } = decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const tracker = new PitchTracker(sampleRate, 2048)
    const hop = Math.round(0.025 * sampleRate)
    let part: string | undefined
    for (let end = STIFFNESS_WINDOW; end <= samples.length; end += hop) {
      const seconds = end / sampleRate
      const now = Object.keys(parts).find((code) => seconds >= parts[code][0] && seconds < parts[code][1])
      if (now !== part) {
        part = now
        tracker.resetNotes({ requireFreshOnset: false })
        tracker.setTargets(part ? [pitchOf(part)] : [])
        tracker.setStiffnessProbe(part ? pitchOf(part) : null)
      }
      for (const event of tracker.process(samples.subarray(end - STIFFNESS_WINDOW, end), seconds * 1000).events) {
        if (part && event.type === 'noteStart' && event.stiffness !== undefined) (measured[part] ??= []).push(event.stiffness)
      }
    }
  }
  return measured
}

describe.skipIf(!available)('string check on the client recordings', { timeout: 120_000 }, () => {
  const measured = available ? measureAll() : {}
  const open = { 1: settledStiffness(measured['10'] ?? []) ?? NaN, 2: settledStiffness(measured['20'] ?? []) ?? NaN }
  const verdicts = (expected: string, played: string): StringVerdict[] => {
    const check = planStringCheck(position(expected), open, STANDARD_TUNING)
    if (!check) throw new Error(`${expected} cannot be checked`)
    return measured[played].map((stiffness) => judgeString(check, stiffness))
  }
  const count = (list: StringVerdict[], played: string) => list.filter((v) => v.result === 'other' && formatGuitarNumber(v.heard) === played).length

  it('every pluck of each position was heard', () => {
    for (const code of ['10', '25', '13', '28', '26']) expect(measured[code]?.length ?? 0, code).toBeGreaterThanOrEqual(5)
    expect(open[1] * 1e5).toBeCloseTo(1.7, 0)
    expect(open[2] * 1e5).toBeCloseTo(4.5, 0)
  })

  it.each([
    ['10', '25'],
    ['25', '10'],
    ['13', '28'],
    ['28', '13'],
    ['11', '26'],
    ['26', '11'],
  ])('expected %s: never "wrong string" when it was played right', (expected) => {
    const list = verdicts(expected, expected)
    expect(list.filter((v) => v.result === 'other'), expected).toEqual([])
  })

  it.each([
    ['10', '25', 1],
    ['25', '10', 1],
    ['13', '28', 1],
    ['28', '13', 1],
    // Two of these 26 plucks were disturbed (another string ringing): "unsure", so not judged.
    ['11', '26', 0.7],
  ])('expected %s, played %s: caught as the wrong string', (expected, played, share) => {
    const list = verdicts(expected, played)
    expect(list.some((v) => v.result === 'expected')).toBe(false)
    expect(count(list, played) / list.length).toBeGreaterThanOrEqual(share)
  })

  it('disturbed plucks are never judged: the 11 plucks here are all "unsure"', () => {
    // The 11 plucks in this recording did not fit a clean string (another string was ringing):
    // all "unsure", so 11 for 26 is not caught, and nothing is ever wrongly caught.
    expect(measured['11'].filter(isClean)).toEqual([])
    expect(verdicts('26', '11').every((v) => v.result === 'unsure')).toBe(true)
  })

  it('20 and 34 (plain string 2, wound string 3) sound too alike on this guitar: not checked', () => {
    // Estimate string 3 open from its clean fret-4 plucks (B doubles every 6 frets).
    const clean34 = measured['34'].filter(isClean).map((s) => s.b)
    expect(clean34.length).toBeGreaterThan(0)
    const open3 = clean34.sort((a, b) => a - b)[clean34.length >> 1] / 2 ** (4 / 6)
    expect(planStringCheck(position('20'), { ...open, 3: open3 }, STANDARD_TUNING)).toBeNull()
  })
})
