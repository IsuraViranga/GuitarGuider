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
import { neighbourPairs, settledStiffness } from '../practice/stringSetup'
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

const measured = available ? measureAll() : {}
/** How many verdicts said "played at `played`". */
const count = (list: StringVerdict[], played: string) => list.filter((v) => v.result === 'other' && formatGuitarNumber(v.heard) === played).length

describe.skipIf(!available)('string check on the client recordings', { timeout: 120_000 }, () => {
  const open = { 1: settledStiffness(measured['10'] ?? [])?.b ?? NaN, 2: settledStiffness(measured['20'] ?? [])?.b ?? NaN }
  const verdicts = (expected: string, played: string): StringVerdict[] => {
    const check = planStringCheck(position(expected), { open }, STANDARD_TUNING)
    if (!check) throw new Error(`${expected} cannot be checked`)
    return measured[played].map((stiffness) => judgeString(check, stiffness))
  }

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
    expect(planStringCheck(position('20'), { open: { ...open, 3: open3 } }, STANDARD_TUNING)).toBeNull()
  })
})

// A whole guitar setup recorded with "Record this setup" (2026-10-27, recordings/guitarStringTrack/):
// each open string plucked until the app moved on, with the app's own log (the string it asked for).
// Strings 3 and 6 were not learned live with one fixed "clean" limit; each string now has its own.
const SETUP_FOLDER = '../recordings/guitarStringTrack'
const setupAvailable = existsSync(`${SETUP_FOLDER}/stringMatch.wav`) && available

describe.skipIf(!setupAvailable)('guitar setup on a real guitar, then the string check with it', { timeout: 120_000 }, () => {
  /** Replays the setup recording as live: the string asked for (from the log), then the setup's rules. */
  function replaySetup() {
    const bytes = readFileSync(`${SETUP_FOLDER}/stringMatch.wav`)
    const { samples, sampleRate } = decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const log = JSON.parse(readFileSync(`${SETUP_FOLDER}/stringMatch.json`, 'utf8')) as { frames: Array<{ t: number; target: number | null; muted?: boolean }> }
    const tracker = new PitchTracker(sampleRate, 2048)
    const plucks: Record<number, Array<Stiffness | null>> = {}
    let target: number | null = null
    for (const frame of log.frames) {
      if (frame.target !== target) {
        target = frame.target
        tracker.resetNotes({ requireFreshOnset: true })
        tracker.setTargets(target === null ? [] : [target])
        tracker.setStiffnessProbe(target)
      }
      const end = Math.round((frame.t / 1000) * sampleRate)
      if (frame.muted || end < STIFFNESS_WINDOW || end > samples.length) continue
      for (const event of tracker.process(samples.subarray(end - STIFFNESS_WINDOW, end), frame.t).events) {
        if (target !== null && event.type === 'noteStart' && event.stiffness !== undefined) (plucks[target] ??= []).push(event.stiffness)
      }
    }
    // Like the setup page: a string is learned as soon as 3 clear plucks agree.
    const strings = { open: {} as Record<number, number>, misfit: {} as Record<number, number> }
    for (const string of [1, 2, 3, 4, 5, 6] as const) {
      const all = plucks[STANDARD_TUNING.openStringMidi[string]] ?? []
      for (let n = 1; n <= all.length; n++) {
        const settled = settledStiffness(all.slice(0, n))
        if (settled) {
          strings.open[string] = settled.b
          strings.misfit[string] = settled.misfit
          break
        }
      }
    }
    return strings
  }
  const strings = setupAvailable ? replaySetup() : { open: {}, misfit: {} }

  it('learns all six strings, wound strings 3 and 6 included', () => {
    const learned = Object.fromEntries(Object.entries(strings.open).map(([s, b]) => [s, Number((b * 1e5).toFixed(1))]))
    expect(Object.keys(learned)).toEqual(['1', '2', '3', '4', '5', '6'])
    // ×10⁻⁵: plain strings 1–2, wound 3–6 (thicker strings are stiffer, except the G).
    const expected = { 1: 1.66, 2: 4.2, 3: 3.8, 4: 6.4, 5: 11.6, 6: 17.7 }
    for (const [s, b] of Object.entries(expected)) expect(learned[s] / b, `string ${s}`).toBeGreaterThan(0.85)
    for (const [s, b] of Object.entries(expected)) expect(learned[s] / b, `string ${s}`).toBeLessThan(1.15)
    expect(strings.misfit[3]).toBeGreaterThan(1.5) // the least regular string
    console.log('learned B ×1e-5', learned, 'usual misfit (cents)', strings.misfit)
  })

  it('says which neighbouring strings it can tell apart on this guitar', () => {
    // 2 and 3 are almost as stiff, but string 3's overtones are far less regular.
    expect(neighbourPairs(strings, STANDARD_TUNING).map((p) => p.status)).toEqual(['checked', 'checked', 'checked', 'checked', 'checked'])
  })

  it('with this setup, the earlier same-note plucks: never a correct note called wrong, wrong strings caught', () => {
    // The earlier recordings are from the same guitar (the open strings measure the same).
    const judged = (expected: string, played: string) => {
      const check = planStringCheck(position(expected), strings, STANDARD_TUNING)
      return check ? measured[played].map((s) => judgeString(check, s)) : null
    }
    for (const code of ['10', '25', '13', '28', '11', '26', '20', '34']) {
      expect((judged(code, code) ?? []).filter((v) => v.result === 'other'), code).toEqual([])
    }
    for (const [expected, played] of [['10', '25'], ['25', '10'], ['13', '28'], ['28', '13']]) {
      expect(judged(expected, played)!.every((v) => v.result === 'other'), `${played} for ${expected}`).toBe(true)
    }
    // 20 and 34: told apart by regularity. Plucks that do not fit the learned pattern stay unsure.
    const at20 = planStringCheck(position('20'), strings, STANDARD_TUNING)!
    expect(at20.others.map((o) => formatGuitarNumber(o.position))).toEqual(['34', '49'])
    const for20 = judged('20', '34')!
    const for34 = judged('34', '20')!
    console.log('34 for 20:', for20.map((v) => v.result).join(' '), '| 20 for 34:', for34.map((v) => v.result).join(' '))
    expect(for20.some((v) => v.result === 'expected')).toBe(false)
    expect(count(for20, '34')).toBeGreaterThanOrEqual(3)
    expect(for34.some((v) => v.result === 'expected')).toBe(false)
    expect(count(for34, '20')).toBeGreaterThanOrEqual(5)
  })
})
