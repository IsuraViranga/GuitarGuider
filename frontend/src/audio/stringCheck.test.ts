import { describe, expect, it } from 'vitest'
import { midiToFrequency } from '../music/pitch'
import { STANDARD_TUNING } from '../music/tuning'
import { neighbourPairs, settledStiffness } from '../practice/stringSetup'
import { concat, mix, noise, SAMPLE_RATE, stiffPluck } from '../test/synth'
import type { NoteEvent } from './noteRecognizer'
import { PitchTracker } from './pitchTracker'
import { createStiffnessMeter, judgeString, planStringCheck, predictStiffness, STIFFNESS_WINDOW, STRING_CHECK_DELAY_MS, type Stiffness } from './stringCheck'

const E4 = midiToFrequency(64)
const ROOM = 0.0008
/** The client's guitar (×10⁻⁵): string 1 open 1.7, string 2 open 4.5. */
const OPEN = { 1: 1.7e-5, 2: 4.5e-5 }
const STRINGS = { open: OPEN }

/** The newest STIFFNESS_WINDOW samples ending `ms` after the start of `signal`. */
const windowAt = (signal: Float32Array, ms: number) => {
  const end = Math.round((ms / 1000) * SAMPLE_RATE)
  return signal.subarray(end - STIFFNESS_WINDOW, end)
}
const clean = (b: number, overtones = 25): Stiffness => ({ b, overtones, misfit: 0.3 })

describe('stiffness measurement', () => {
  const meter = createStiffnessMeter(SAMPLE_RATE)

  it.each([1.7e-5, 7.7e-5, 2e-4])('recovers B = %s from a stiff string, as on a real guitar', (b) => {
    const sound = mix(stiffPluck(E4, 0.5, { b }), noise(0.5, ROOM))
    const measured = meter(windowAt(sound, 200), E4)!
    expect(measured.b / b).toBeGreaterThan(0.95)
    expect(measured.b / b).toBeLessThan(1.05)
    expect(measured.overtones).toBeGreaterThanOrEqual(20)
    expect(measured.misfit).toBeLessThan(0.5)
  })

  it('works with a guess of the note that is a little off (the guitar slightly out of tune)', () => {
    const sound = stiffPluck(E4 * 1.01, 0.5, { b: 7.7e-5 })
    expect(meter(windowAt(sound, 200), E4)!.b).toBeCloseTo(7.7e-5, 6)
  })

  it('gives no measurement for room noise or too little sound', () => {
    expect(meter(noise(0.5, 0.01), E4)).toBeNull()
    expect(meter(new Float32Array(1000), E4)).toBeNull()
  })

  it('B doubles every 6 frets on one string', () => {
    expect(predictStiffness(OPEN, { stringNumber: 2, fret: 6 })).toBeCloseTo(9e-5, 12)
    expect(predictStiffness(OPEN, { stringNumber: 2, fret: 12 })).toBeCloseTo(18e-5, 12)
    expect(predictStiffness(OPEN, { stringNumber: 3, fret: 4 })).toBeNull() // string 3 not measured
  })
})

describe('which positions can be checked', () => {
  it('10 can be told from 25 (strings 1 and 2 differ about 4×); 39 is skipped while string 3 is not measured', () => {
    const check = planStringCheck({ stringNumber: 1, fret: 0 }, STRINGS, STANDARD_TUNING)!
    expect(check.others.map((o) => o.position)).toEqual([{ stringNumber: 2, fret: 5 }])
  })

  it('nothing to check when the other strings sound too alike (20 and 34 on the client guitar)', () => {
    // String 3 (wound) open about 2.9: at fret 4 that is 4.6, next to string 2 open at 4.5.
    expect(planStringCheck({ stringNumber: 2, fret: 0 }, { open: { 2: 4.5e-5, 3: 2.9e-5 } }, STANDARD_TUNING)).toBeNull()
  })

  it('nothing to check without a setup for the string, or for a note only one string has', () => {
    expect(planStringCheck({ stringNumber: 3, fret: 0 }, STRINGS, STANDARD_TUNING)).toBeNull()
    expect(planStringCheck({ stringNumber: 6, fret: 0 }, { open: { 6: 2e-4 } }, STANDARD_TUNING)).toBeNull()
  })
})

describe('string verdicts', () => {
  const check = planStringCheck({ stringNumber: 1, fret: 0 }, STRINGS, STANDARD_TUNING)! // 10: 1.7, 25: 8.0

  it('the expected string', () => {
    expect(judgeString(check, clean(1.8e-5))).toEqual({ result: 'expected' })
  })

  it('clearly the other string', () => {
    expect(judgeString(check, clean(7.7e-5))).toEqual({ result: 'other', heard: { stringNumber: 2, fret: 5 } })
  })

  it('unsure (the note counts) when the measurement is missing, disturbed, thin or in between', () => {
    expect(judgeString(check, null)).toEqual({ result: 'unsure' })
    expect(judgeString(check, { b: 7.7e-5, overtones: 25, misfit: 4 })).toEqual({ result: 'unsure' }) // another string ringing
    expect(judgeString(check, { b: -1e-5, overtones: 25, misfit: 0.3 })).toEqual({ result: 'unsure' })
    expect(judgeString(check, clean(7.7e-5, 8))).toEqual({ result: 'unsure' }) // few overtones
    expect(judgeString(check, clean(3.6e-5))).toEqual({ result: 'unsure' }) // between the two
    expect(judgeString(check, clean(40e-5))).toEqual({ result: 'unsure' }) // matches neither
  })

  describe('each string judged against how regular it normally is (learned in the setup)', () => {
    // A real guitar: string 3 (wound) usually fits within 2.5 cents, string 4 within 0.6.
    const strings = { open: { 3: 3.7e-5, 4: 6.4e-5 }, misfit: { 3: 2.5, 4: 0.6 } }
    const at30 = planStringCheck({ stringNumber: 3, fret: 0 }, strings, STANDARD_TUNING)! // 30: 3.7, 45: 11.4
    const wound = (b: number, misfit: number): Stiffness => ({ b, overtones: 24, misfit })

    it('a normal pluck of a wound string counts, though less regular than a plain one', () => {
      expect(at30.expected.maxMisfit).toBe(3.5) // 1.4 × 2.5
      expect(judgeString(at30, wound(3.9e-5, 2.9))).toEqual({ result: 'expected' })
    })

    it('the other string must fit as well as it normally does', () => {
      expect(at30.others[0].maxMisfit).toBe(1.5) // string 4: 1.4 × 0.6 is below the floor
      expect(judgeString(at30, wound(11e-5, 0.9))).toEqual({ result: 'other', heard: { stringNumber: 4, fret: 5 } })
      expect(judgeString(at30, wound(11e-5, 2.9))).toEqual({ result: 'unsure' }) // too irregular for string 4
    })

    it('never trusted above 3.5 cents (disturbed plucks measured 3.9–11)', () => {
      const loose = planStringCheck({ stringNumber: 3, fret: 0 }, { ...strings, misfit: { 3: 3.4, 4: 3.4 } }, STANDARD_TUNING)!
      expect(loose.expected.maxMisfit).toBe(3.5)
      expect(judgeString(loose, wound(11e-5, 3.9))).toEqual({ result: 'unsure' })
    })

    it('setups saved before this keep the plain-string limit', () => {
      expect(planStringCheck({ stringNumber: 3, fret: 0 }, { open: strings.open }, STANDARD_TUNING)!.expected.maxMisfit).toBe(1.5)
    })
  })
})

describe('string check in the live tracker', () => {
  /** Runs the tracker over the signal as the live app does (8192-sample slices every 25 ms). */
  function run(signal: Float32Array, probe: number | null) {
    const tracker = new PitchTracker(SAMPLE_RATE, 2048)
    tracker.setTargets([64])
    tracker.setStiffnessProbe(probe)
    const events: Array<NoteEvent & { reportedAt: number }> = []
    const hop = Math.round(0.025 * SAMPLE_RATE)
    for (let end = STIFFNESS_WINDOW; end <= signal.length; end += hop) {
      const time = (end / SAMPLE_RATE) * 1000
      for (const event of tracker.process(signal.subarray(end - STIFFNESS_WINDOW, end), time).events) events.push({ ...event, reportedAt: time })
    }
    return events
  }
  const quiet = noise(1, ROOM, 5)
  const played25 = concat(quiet, mix(stiffPluck(E4, 1.5, { b: 7.7e-5 }), noise(1.5, ROOM, 6)))

  it('without a string check: notes as before, no measurement', () => {
    const events = run(played25, null)
    expect(events.map((e) => e.type)).toEqual(['noteStart', 'noteConfirmed'])
    expect(events.every((e) => !('stiffness' in e))).toBe(true)
  })

  it('with a string check: the note comes about 200 ms after the pluck, with its stiffness', () => {
    const before = run(played25, null)[0].reportedAt
    const events = run(played25, 64)
    expect(events.map((e) => e.type)).toEqual(['noteStart', 'noteConfirmed'])
    expect(events[0].reportedAt).toBeGreaterThanOrEqual(1000 + STRING_CHECK_DELAY_MS)
    expect(events[0].reportedAt - before).toBeLessThanOrEqual(STRING_CHECK_DELAY_MS)
    expect(events[0].stiffness!.b).toBeCloseTo(7.7e-5, 6)
    expect(events[1].stiffness).toEqual(events[0].stiffness) // the confirmation carries the same measurement
  })

  it('other notes are not held back', () => {
    const g4 = concat(quiet, stiffPluck(midiToFrequency(67), 1.5, { b: 3e-5 }))
    expect(run(g4, 64).every((e) => !('stiffness' in e))).toBe(true)
  })

  it('a note cut short by the next pluck comes without a measurement', () => {
    const quick = concat(quiet, stiffPluck(E4, 0.15, { b: 7.7e-5 }), stiffPluck(midiToFrequency(67), 1, { b: 3e-5, seed: 9 }))
    const first = run(quick, 64).find((e) => e.type === 'noteStart')!
    expect(Math.round(first.midi)).toBe(64)
    expect(first.stiffness).toBeNull()
  })
})

describe('guitar setup', () => {
  it('keeps a string once 3 clean plucks agree (within 15%)', () => {
    expect(settledStiffness([clean(4.5e-5), clean(4.6e-5)])).toBeNull()
    expect(settledStiffness([clean(4.5e-5), clean(4.6e-5), clean(4.2e-5)])).toEqual({ b: 4.5e-5, misfit: 0.3 })
  })

  it('ignores disturbed plucks and waits while plucks disagree', () => {
    expect(settledStiffness([clean(4.5e-5), { b: 7e-4, overtones: 21, misfit: 5.4 }, clean(4.6e-5), null, clean(4.4e-5)])).toEqual({ b: 4.5e-5, misfit: 0.3 })
    expect(settledStiffness([clean(4.5e-5), clean(9e-5), clean(4.4e-5)])).toBeNull()
  })

  it('learns a wound string, whose overtones are less regular, and how regular it is', () => {
    const g = (b: number, misfit: number): Stiffness => ({ b, overtones: 24, misfit })
    expect(settledStiffness([g(3.68e-5, 2.81), g(3.6e-5, 2.17), g(4.06e-5, 2.46)])).toEqual({ b: 3.68e-5, misfit: 2.46 })
  })

  it('tells which neighbouring strings it can check', () => {
    expect(neighbourPairs({ 1: 1.7e-5, 2: 4.5e-5, 3: 2.9e-5 }, STANDARD_TUNING).slice(0, 3)).toEqual([
      { strings: [1, 2], status: 'checked' },
      { strings: [2, 3], status: 'too-alike' },
      { strings: [3, 4], status: 'not-measured' },
    ])
  })
})
