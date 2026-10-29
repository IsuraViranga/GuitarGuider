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
import { isClean, judgeString, MAX_JUDGED_FRET, planStringCheck, STIFFNESS_WINDOW, type Stiffness, type StringVerdict } from './stringCheck'
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
    // Not checked (e.g. 28 is above MAX_JUDGED_FRET): the note counts, as before.
    return check ? measured[played].map((stiffness) => judgeString(check, stiffness)) : []
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
    // (13 expected, 28 played is not judged: 28 is above fret 7, MAX_JUDGED_FRET.)
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

/** Replays the setup recording as live: the string asked for (from the log), then the setup's rules. */
function replaySetupStrings() {
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

describe.skipIf(!setupAvailable)('guitar setup on a real guitar, then the string check with it', { timeout: 120_000 }, () => {
  const strings = setupAvailable ? replaySetupStrings() : { open: {}, misfit: {} }

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
    for (const [expected, played] of [['10', '25'], ['25', '10'], ['28', '13']]) {
      expect(judged(expected, played)!.every((v) => v.result === 'other'), `${played} for ${expected}`).toBe(true)
    }
    // 20 and 34: told apart by regularity. Plucks that do not fit the learned pattern stay unsure.
    const at20 = planStringCheck(position('20'), strings, STANDARD_TUNING)!
    expect(at20.others.map((o) => formatGuitarNumber(o.position))).toEqual(['34']) // 49 is above fret 7
    const for20 = judged('20', '34')!
    const for34 = judged('34', '20')!
    console.log('34 for 20:', for20.map((v) => v.result).join(' '), '| 20 for 34:', for34.map((v) => v.result).join(' '))
    expect(for20.some((v) => v.result === 'expected')).toBe(false)
    expect(count(for20, '34')).toBeGreaterThanOrEqual(3)
    expect(for34.some((v) => v.result === 'expected')).toBe(false)
    expect(count(for34, '20')).toBeGreaterThanOrEqual(5)
  })
})

// Strings 2 and 3 in practice (2026-10-27, recordings/guitarStringTrack/tandthree): the song
// "20 20 20 21 21 21 23 23 23 34 34 34 35 35 35 37 37 37" in Note by note, each note played on its
// own string, then on the other string a few times. What was played, by time (seconds):
const PAIRS_SONG = '20 20 20 21 21 21 23 23 23 34 34 34 35 35 35 37 37 37'.split(' ')
const PAIRS_PLAYED: Array<[number, number, string]> = [
  [4, 5, '20'], [10, 24, '34'], [34, 35, '21'], [40, 50, '35'], [58, 59, '23'], [66, 73, '37'],
  [78, 79, '34'], [84, 91, '20'], [101, 102, '35'], [105, 107, '21'], [115, 116, '37'],
]
const pairsAvailable = setupAvailable && existsSync(`${SETUP_FOLDER}/tandthree.wav`)

describe.skipIf(!pairsAvailable)('strings 2 and 3 in a real practice', { timeout: 120_000 }, () => {
  it('every right note counts; the other string is caught when the pluck is clear', () => {
    const strings = replaySetupStrings()
    const bytes = readFileSync(`${SETUP_FOLDER}/tandthree.wav`)
    const { samples, sampleRate } = decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const log = JSON.parse(readFileSync(`${SETUP_FOLDER}/tandthree.json`, 'utf8')) as {
      frames: Array<{ t: number; muted?: boolean }>
      events: Array<{ t: number; kind: string; index?: number }>
    }
    // The note the app was on at each moment (as logged), and the check it made for it.
    const steps = log.events.filter((e) => e.kind === 'practice')
    const stepAt = (t: number) => steps.filter((e) => e.t < t).at(-1)?.index ?? 0
    const tracker = new PitchTracker(sampleRate, 2048)
    const verdicts: Record<string, string[]> = {}
    let step = -1
    for (const frame of log.frames) {
      const end = Math.round((frame.t / 1000) * sampleRate)
      if (stepAt(frame.t) !== step) {
        step = stepAt(frame.t)
        tracker.resetNotes({ requireFreshOnset: true })
        tracker.setTargets([pitchOf(PAIRS_SONG[step])])
        tracker.setStiffnessProbe(pitchOf(PAIRS_SONG[step]))
      }
      if (frame.muted || end < STIFFNESS_WINDOW || end > samples.length) continue
      for (const event of tracker.process(samples.subarray(end - STIFFNESS_WINDOW, end), frame.t).events) {
        const played = PAIRS_PLAYED.find(([a, b]) => frame.t / 1000 >= a && frame.t / 1000 <= b)?.[2]
        if (event.type !== 'noteStart' || event.stiffness === undefined || !played) continue
        const check = planStringCheck(position(PAIRS_SONG[step]), strings, STANDARD_TUNING)!
        const verdict = judgeString(check, event.stiffness)
        ;(verdicts[`${played} for ${PAIRS_SONG[step]}`] ??= []).push(verdict.result === 'other' ? formatGuitarNumber(verdict.heard) : verdict.result)
      }
    }
    console.log(verdicts)
    for (const [key, list] of Object.entries(verdicts)) {
      const [played, , expected] = key.split(' ')
      if (played === expected) expect(list.every((v) => v !== 'other' && !/^\d/.test(v)), key).toBe(true)
      else expect(list.every((v) => v === played || v === 'unsure' || v === 'expected'), key).toBe(true)
    }
    // Caught (measured 2026-10-27). Misses: two 21s plucked into the still-ringing note before
    // (measured as noise), and two 37s just above the 3.5-cent limit (string 3 at fret 7).
    const caught = (key: string) => verdicts[key].filter((v) => v === key.split(' ')[0]).length
    expect(caught('34 for 20')).toBe(6)
    expect(caught('35 for 21')).toBe(5)
    expect(caught('20 for 34')).toBe(4)
    expect(caught('37 for 23')).toBeGreaterThanOrEqual(2)
    expect(caught('21 for 35')).toBeGreaterThanOrEqual(1)
  })
})

// All 55 same-note pairs up to fret 12 (2026-10-29, recordings/guitarPracRecords/prac1–5): five test
// songs, each pair as "a a a b b b", every note played on its own string in Note by note. Each pluck
// (as measured on the phone, from the log) is judged twice: with its own position expected (must
// count) and with the pair's other position expected (should be caught). The setup is the one
// recorded on another day (recordings/guitarStringTrack), so the test does not grade itself.
const PRAC_FOLDER = '../recordings/guitarPracRecords'
/** Wrong strings caught on the owner's guitar (every fret recordings), measured 2026-10-29. */
const FRETS_CAUGHT = 106 // of 179 (other position up to fret 7)
const PRAC_SONGS = [
  '10 25 11 26 12 27 13 28 14 29 15 210 16 211 17 212 10 39 11 310 12 311 13 312',
  '20 34 21 35 22 36 23 37 24 38 25 39 26 310 27 311 28 312 20 49 21 410 22 411 23 412',
  '30 45 31 46 32 47 33 48 34 49 35 410 36 411 37 412 30 510 31 511 32 512',
  '40 55 41 56 42 57 43 58 44 59 45 510 46 511 47 512 40 610 41 611 42 612',
  '50 65 51 66 52 67 53 68 54 69 55 610 56 611 57 612',
].map((pairs) => pairs.split(' '))
/** Two slips: the previous position plucked once more at the start of the next (measured exactly like it). */
/** Wrong strings caught (the other position up to fret 7), measured 2026-10-29: 119 of 210. */
const CAUGHT_UP_TO_FRET_7 = 119
const PRAC_SLIPS = [{ code: '27', b: 2.15 }, { code: '510', b: 4.06 }]
const pracAvailable = setupAvailable && [1, 2, 3, 4, 5].every((n) => existsSync(`${PRAC_FOLDER}/prac${n}.json`))

describe.skipIf(!pracAvailable)('all same-note pairs, played on a real guitar', { timeout: 120_000 }, () => {
  it('no correct note is called the wrong string; most wrong strings are caught', () => {
    const strings = replaySetupStrings()
    let right = 0
    let wronglyCalled = 0
    let wrong = 0
    let caught = 0
    PRAC_SONGS.forEach((pairs, s) => {
      const log = JSON.parse(readFileSync(`${PRAC_FOLDER}/prac${s + 1}.json`, 'utf8')) as {
        events: Array<{ kind: string; index?: number; stiffness?: { b: number; overtones: number; misfit: number } | null }>
      }
      const song = pairs.flatMap((_, i) => (i % 2 === 0 ? [...Array(3).fill(pairs[i]), ...Array(3).fill(pairs[i + 1])] : []))
      const partner = (i: number) => pairs[Math.floor(i / 6) * 2 + (i % 6 < 3 ? 1 : 0)]
      let step = 0
      for (const event of log.events) {
        if (event.kind === 'practice') step = event.index ?? step
        if (event.kind !== 'noteStart' || event.stiffness === undefined) continue
        const played = song[Math.min(step, song.length - 1)]
        const measured = event.stiffness && { ...event.stiffness, b: event.stiffness.b * 1e-5 }
        if (measured && PRAC_SLIPS.some((slip) => slip.code === played && slip.b === event.stiffness!.b)) continue
        const own = planStringCheck(position(played), strings, STANDARD_TUNING)
        if (own) {
          right++
          if (judgeString(own, measured).result === 'other') wronglyCalled++
        }
        // The wrong string is only named up to MAX_JUDGED_FRET: count the plucks it can be named for.
        if (position(played).fret > MAX_JUDGED_FRET) continue
        const other = planStringCheck(position(partner(Math.min(step, song.length - 1))), strings, STANDARD_TUNING)
        wrong++
        const verdict = other && judgeString(other, measured)
        if (verdict?.result === 'other' && formatGuitarNumber(verdict.heard) === played) caught++
      }
    })
    console.log(`55 pairs: correct notes called wrong ${wronglyCalled}/${right}; wrong strings (up to fret 7) caught ${caught}/${wrong}`)
    expect(wronglyCalled).toBe(0)
    // Measured 2026-10-29 with the other day's setup (at least 18 overtones, other position up to fret 7).
    expect(caught).toBeGreaterThanOrEqual(CAUGHT_UP_TO_FRET_7)
  })
})

// Every fret 0–12 on all six strings, 3 plucks each, on the owner's guitar, with that day's setup
// (2026-10-29, recordings/allFrets: setupnew11, song1new–song3new). Each pluck is judged with its
// own position expected (must count) and with every same-note position up to fret 7 expected.
const FRETS_FOLDER = '../recordings/allFrets'
const fretsAvailable = ['setupnew11', 'song1new', 'song2new', 'song3new'].every((n) => existsSync(`${FRETS_FOLDER}/${n}.wav`))

describe.skipIf(!fretsAvailable)('every fret on the owner guitar', { timeout: 600_000 }, () => {
  type Log = { frames: Array<{ t: number; target: number | null; muted?: boolean }>; events: Array<{ t: number; kind: string; index?: number }> }
  /** Replays a recording as live, labelling each measured pluck with `labelAt`. */
  function replay(name: string, labelAt: (t: number, target: number | null, log: Log) => string | null) {
    const bytes = readFileSync(`${FRETS_FOLDER}/${name}.wav`)
    const { samples, sampleRate } = decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const log = JSON.parse(readFileSync(`${FRETS_FOLDER}/${name}.json`, 'utf8')) as Log
    const tracker = new PitchTracker(sampleRate, 2048)
    const plucks: Record<string, Array<Stiffness | null>> = {}
    let target: number | null | undefined
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
        const label = labelAt(frame.t, target, log)
        if (label && event.type === 'noteStart' && event.stiffness !== undefined) (plucks[label] ??= []).push(event.stiffness)
      }
    }
    return plucks
  }

  it('no correct note is called the wrong string; most wrong strings up to fret 7 are caught', () => {
    const openCode: Record<number, string> = Object.fromEntries(([1, 2, 3, 4, 5, 6] as const).map((s) => [STANDARD_TUNING.openStringMidi[s], `${s}0`]))
    const setupPlucks = replay('setupnew11', (_, target) => (target === null ? null : (openCode[target] ?? null)))
    const strings = { open: {} as Record<number, number>, misfit: {} as Record<number, number> }
    for (const s of [1, 2, 3, 4, 5, 6]) {
      const all = setupPlucks[`${s}0`] ?? []
      for (let n = 1; n <= all.length; n++) {
        const settled = settledStiffness(all.slice(0, n))
        if (settled) {
          strings.open[s] = settled.b
          strings.misfit[s] = settled.misfit
          break
        }
      }
    }
    expect(Object.keys(strings.open)).toEqual(['1', '2', '3', '4', '5', '6'])
    const plucks: Record<string, Array<Stiffness | null>> = {}
    ;[[1, 2], [3, 4], [5, 6]].forEach((pair, i) => {
      const song = pair.flatMap((s) => Array.from({ length: 13 }, (_, f) => Array(3).fill(`${s}${f}`)).flat())
      const got = replay(`song${i + 1}new`, (t, _, log) => {
        const step = log.events.filter((e) => e.kind === 'practice' && e.t <= t).at(-1)?.index ?? 0
        return song[Math.min(step, song.length - 1)]
      })
      for (const [code, list] of Object.entries(got)) (plucks[code] ??= []).push(...list)
    })
    let right = 0
    let wronglyCalled = 0
    let wrong = 0
    let caught = 0
    for (const [code, list] of Object.entries(plucks)) {
      const own = planStringCheck(position(code), strings, STANDARD_TUNING)
      for (const measured of list) {
        if (own) {
          right++
          if (judgeString(own, measured).result === 'other') wronglyCalled++
        }
      }
      if (position(code).fret > MAX_JUDGED_FRET) continue
      // As if a same-note position were expected and this one was played instead.
      const midi = STANDARD_TUNING.openStringMidi[position(code).stringNumber] + position(code).fret
      for (const s of [1, 2, 3, 4, 5, 6] as const) {
        const fret = midi - STANDARD_TUNING.openStringMidi[s]
        if (s === position(code).stringNumber || fret < 0 || fret > 12) continue
        const check = planStringCheck({ stringNumber: s, fret }, strings, STANDARD_TUNING)
        if (!check?.others.some((o) => formatGuitarNumber(o.position) === code)) continue
        for (const measured of list) {
          wrong++
          const verdict = judgeString(check, measured)
          if (verdict.result === 'other' && formatGuitarNumber(verdict.heard) === code) caught++
        }
      }
    }
    console.log(`every fret: correct notes called wrong ${wronglyCalled}/${right}; wrong strings (up to fret 7) caught ${caught}/${wrong}`)
    expect(wronglyCalled).toBe(0)
    expect(caught).toBeGreaterThanOrEqual(FRETS_CAUGHT)
  })
})
