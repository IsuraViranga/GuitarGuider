import { describe, expect, it } from 'vitest'
import { midiToFrequency } from '../music/pitch'
import { compareToTarget } from '../practice/matching'
import { concat, mix, noise, pluck, SAMPLE_RATE } from '../test/synth'
import { NoteRecognizer, type NoteEvent } from './noteRecognizer'
import { analyseSignal, PitchTracker } from './pitchTracker'

/** Quiet room: a little background hiss, then the tracker's 0.8 s calibration is done. */
const ROOM = 0.0008
const quietStart = () => noise(1, ROOM, 99)
const note = (midi: number, seconds: number, seed = midi) =>
  mix(pluck(midiToFrequency(midi), seconds, { seed }), noise(seconds, ROOM, seed + 1000))

const starts = (events: NoteEvent[]) => events.filter((e) => e.type === 'noteStart')
const startMidis = (events: NoteEvent[]) => starts(events).map((e) => Math.round(e.midi))

describe('detection chain on generated guitar sounds', () => {
  it('stays silent in a quiet room', () => {
    expect(analyseSignal(noise(4, ROOM), SAMPLE_RATE).events).toEqual([])
  })

  it('ignores loud background noise (no false notes)', () => {
    expect(analyseSignal(concat(quietStart(), noise(3, 0.05, 5)), SAMPLE_RATE).events).toEqual([])
  })

  it('ignores a note too quiet to be distinguished from the room', () => {
    const faint = mix(pluck(329.63, 2, { amplitude: 0.0015 }), noise(2, ROOM))
    expect(analyseSignal(concat(quietStart(), faint), SAMPLE_RATE).events).toEqual([])
  })

  it('reports one sustained note exactly once (start + confirmation)', () => {
    const { events } = analyseSignal(concat(quietStart(), note(64, 4)), SAMPLE_RATE)
    expect(events.map((e) => e.type)).toEqual(['noteStart', 'noteConfirmed'])
    expect(events[0].noteId).toBe(events[1].noteId)
    expect(Math.round(events[0].midi)).toBe(64)
  })

  it('reports a sustained low E once, without octave mistakes as it decays', () => {
    const { events } = analyseSignal(concat(quietStart(), note(40, 5)), SAMPLE_RATE)
    expect(startMidis(events)).toEqual([40])
  })

  it('recognises a melody of different notes in order', () => {
    const melody = concat(quietStart(), note(64, 0.6), note(67, 0.6), note(60, 0.6), note(45, 0.8))
    expect(startMidis(analyseSignal(melody, SAMPLE_RATE).events)).toEqual([64, 67, 60, 45])
  })

  it('counts each pluck of a repeated note (e.g. "10 10 10")', () => {
    const repeated = concat(quietStart(), note(64, 0.5, 1), note(64, 0.5, 2), note(64, 0.5, 3))
    expect(startMidis(analyseSignal(repeated, SAMPLE_RATE).events)).toEqual([64, 64, 64])
  })

  it('counts a note again after a short silence', () => {
    const signal = concat(quietStart(), note(55, 0.5), noise(0.25, ROOM), note(55, 0.5, 9))
    expect(startMidis(analyseSignal(signal, SAMPLE_RATE).events)).toEqual([55, 55])
  })

  it('reacts quickly (well under a quarter of a second after the pluck)', () => {
    const { events } = analyseSignal(concat(quietStart(), note(64, 1)), SAMPLE_RATE)
    expect(events[0].time - 1000).toBeLessThan(200)
  })

  it('after a reset, a still-ringing note does not count, but the next pluck does', () => {
    const signal = concat(quietStart(), note(64, 2), note(64, 1, 77))
    const tracker = new PitchTracker(SAMPLE_RATE, 2048)
    const hop = 1200 // 25 ms
    const events: NoteEvent[] = []
    let resetDone = false
    for (let end = 2048; end <= signal.length; end += hop) {
      const time = (end / SAMPLE_RATE) * 1000
      // Simulate the student jumping to another note 0.5 s into the first (ringing) note.
      if (!resetDone && time > 1500) {
        tracker.resetNotes({ requireFreshOnset: true })
        resetDone = true
      }
      events.push(...tracker.process(signal.subarray(end - 2048, end), time).events)
    }
    const startTimes = starts(events).map((e) => e.time)
    expect(startTimes).toHaveLength(2) // the first pluck (before reset) and the fresh pluck at 3 s
    expect(startTimes[1]).toBeGreaterThan(3000)
    expect(events.filter((e) => e.type === 'noteConfirmed')).toHaveLength(2) // first note confirmed before reset
  })
})

describe('NoteRecognizer rules', () => {
  /** [midi or null, pluck?] per reading, 25 ms apart; the clock keeps running across calls. */
  const clocks = new WeakMap<NoteRecognizer, number>()
  const feed = (recognizer: NoteRecognizer, inputs: Array<[number | null, boolean?]>) =>
    inputs.flatMap(([midi, onset]) => {
      const time = (clocks.get(recognizer) ?? 0) + 25
      clocks.set(recognizer, time)
      return recognizer.push({ time, midi, rms: 0.1, onset: onset ?? false })
    })
  const PLUCK = true

  it('needs a pluck and several steady readings before reporting a note', () => {
    const r = new NoteRecognizer()
    expect(feed(r, [[64, PLUCK], [64.05]])).toEqual([])
    expect(feed(r, [[63.98]]).map((e) => e.type)).toEqual(['noteStart'])
  })

  it('never reports a sound that started without a pluck (e.g. a string still ringing)', () => {
    const r = new NoteRecognizer()
    expect(feed(r, [[64], [64], [64], [64], [64], [64]])).toEqual([])
  })

  it('reports one note per pluck, with its confirmation', () => {
    const r = new NoteRecognizer()
    const events = feed(r, [[64, PLUCK], [64], [64], [64], [64], [64], [64], [64]])
    expect(events.map((e) => e.type)).toEqual(['noteStart', 'noteConfirmed'])
  })

  it('a second pluck of the same pitch is a new note ("10 10")', () => {
    const r = new NoteRecognizer()
    const events = feed(r, [[64, PLUCK], [64], [64], [64], [64, PLUCK], [64], [64]])
    expect(starts(events)).toHaveLength(2)
  })

  it('a short note that is very clearly the expected one needs only two readings', () => {
    const r = new NoteRecognizer()
    const strong = (midi: number, onset = false) => r.push({ time: (clocks.get(r) ?? 0) + 25, midi, rms: 0.1, onset, strong: true })
    clocks.set(r, 0)
    expect(strong(65, true)).toEqual([])
    clocks.set(r, 25)
    expect(strong(65).map((e) => e.type)).toEqual(['noteStart'])
  })

  it('ignores a single wobbly reading', () => {
    const r = new NoteRecognizer()
    const events = feed(r, [[64, PLUCK], [66], [64], [64], [64]])
    expect(starts(events).map((e) => e.midi)).toEqual([64])
  })

  it('a pitch change long after the pluck is not a new note (blend or decay)', () => {
    const r = new NoteRecognizer()
    const events = feed(r, [[64, PLUCK], [64], [64], [64], [64], [64], [64], [64], [62], [62], [62], [62]])
    expect(starts(events).map((e) => e.midi)).toEqual([64])
  })

  it('is not locked out by an octave-wrong first reading of a new pluck', () => {
    const r = new NoteRecognizer()
    const events = feed(r, [[67, PLUCK], [67], [67], [48, PLUCK], [60], [60], [60]])
    expect(starts(events).map((e) => e.midi)).toEqual([67, 60])
  })

  it('one pluck never produces two notes, even if the pitch jumps right after', () => {
    const r = new NoteRecognizer()
    const events = feed(r, [[64, PLUCK], [64], [64], [57], [57], [57], [57]])
    expect(starts(events).map((e) => e.midi)).toEqual([64])
  })

  it('ends a note after a few unreliable readings; a new pluck starts the next', () => {
    const r = new NoteRecognizer()
    const events = feed(r, [[60, PLUCK], [60], [60], [null], [null], [null], [60, PLUCK], [60], [60]])
    expect(starts(events)).toHaveLength(2)
  })

  it('after a reset, the ringing note is ignored until the next pluck', () => {
    const r = new NoteRecognizer()
    feed(r, [[64, PLUCK], [64], [64]])
    r.reset({ requireFreshOnset: true })
    expect(feed(r, [[64], [64], [64], [64]])).toEqual([])
    expect(starts(feed(r, [[64, PLUCK], [64], [64]]))).toHaveLength(1)
  })
})

describe('compareToTarget', () => {
  it('accepts small tuning differences as in tune', () => {
    expect(compareToTarget(64.2, 64)).toMatchObject({ result: 'correct', inTune: true })
    expect(compareToTarget(63.65, 64)).toMatchObject({ result: 'correct', inTune: true })
  })

  it('accepts an out-of-tune guitar (up to 70 cents) with a hint', () => {
    expect(compareToTarget(64.62, 64)).toMatchObject({ result: 'correct', inTune: false, heardMidi: 64 })
    expect(compareToTarget(63.4, 64)).toMatchObject({ result: 'correct', inTune: false })
    expect(compareToTarget(64.75, 64).result).toBe('wrong')
  })

  it('calls other notes wrong', () => {
    expect(compareToTarget(65, 64)).toMatchObject({ result: 'wrong', heardMidi: 65, octaveOff: false })
  })

  it('flags octave mistakes as wrong, but recognisably so', () => {
    expect(compareToTarget(52, 64)).toMatchObject({ result: 'wrong', octaveOff: true })
    expect(compareToTarget(76.1, 64)).toMatchObject({ result: 'wrong', octaveOff: true })
  })
})

describe('noise gate calibration', () => {
  it('is not made deaf by a string ringing during the quiet check', () => {
    // A note is still ringing when listening starts, then the student plays a soft E4.
    const ringing = mix(pluck(196, 1, { amplitude: 0.3, seed: 3 }), noise(1, ROOM, 4))
    const soft = mix(pluck(329.63, 1.5, { amplitude: 0.05, seed: 8 }), noise(1.5, ROOM, 9))
    const { events, tracker } = analyseSignal(concat(ringing, noise(0.5, ROOM, 5), soft), SAMPLE_RATE)
    expect(tracker.gate).toBeLessThanOrEqual(0.01)
    expect(startMidis(events)).toContain(64)
  })
})

describe('pluck during the error-sound pause', () => {
  /** Plays `signal`, skipping frames (the app not listening) from `gapFrom` to `gapTo` ms. */
  function playWithGap(signal: Float32Array, target: number, gapFrom: number, gapTo: number) {
    const tracker = new PitchTracker(SAMPLE_RATE, 2048)
    tracker.setTarget(target)
    const events: NoteEvent[] = []
    let skipped = false
    for (let end = 2048; end <= signal.length; end += 1200) {
      const time = (end / SAMPLE_RATE) * 1000
      if (time > gapFrom && time < gapTo) {
        skipped = true
        continue
      }
      events.push(...tracker.process(signal.subarray(end - 2048, end), time, { afterGap: skipped }).events)
      skipped = false
    }
    return events
  }

  it('the corrected note played during the pause is recognised when listening resumes', () => {
    // A wrong F4 is plucked at 1.0 s; the pause starts 0.13 s later; G4 is plucked during it.
    const signal = concat(quietStart(), note(65, 0.2, 3), note(67, 1.2, 5))
    const events = playWithGap(signal, 67, 1130, 1370)
    expect(startMidis(events)).toEqual([65, 67])
  })

  it('a wrong note that keeps ringing through the pause is not counted again', () => {
    const signal = concat(quietStart(), note(65, 2, 3))
    const events = playWithGap(signal, 67, 1130, 1370)
    expect(startMidis(events)).toEqual([65])
  })
})
