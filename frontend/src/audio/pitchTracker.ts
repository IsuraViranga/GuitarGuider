// The whole detection chain for one audio frame, with no browser APIs, so the exact same
// code runs live on the phone and in tests on generated sounds:
//
//   samples → YIN pitch → noise gate + clarity check → note recognizer → events
//                       ↘ pluck (onset) detection ↗
//                       ↘ expected-note check (when the practice target is known) ↗

import { frequencyToMidi, midiToFrequency } from '../music/pitch'
import { DEFAULT_MATCH_CONFIG } from '../practice/matching'
import { DEFAULT_RECOGNIZER_CONFIG, NoteRecognizer, type NoteEvent, type RecognizerConfig } from './noteRecognizer'
import { createPitchDetector, DEFAULT_YIN_OPTIONS, type PitchDetector, type PitchMatch, type YinOptions } from './pitchDetector'

export type TrackerConfig = {
  yin: YinOptions
  recognizer: RecognizerConfig
  /** Readings below this clarity are ignored. */
  minClarity: number
  /** At the start, listen to the room for this long to measure background noise. */
  calibrationMs: number
  /** The noise gate is this many times the measured background level... */
  gateMultiplier: number
  /** ...but never below/above these limits (so a noisy start can't make the app deaf). */
  minGate: number
  maxGate: number
  /**
   * A pluck (onset) is a rise in "attack level" by at least this factor between readings. The
   * attack level measures bright, high-frequency sound in the newest part of the frame: a fresh
   * pluck is bright, strings that have been ringing for a while are not, so a new pluck stands
   * out even when several other strings are still sounding...
   */
  onsetRatio: number
  /** ...while the overall level is at least this many times the noise gate. */
  onsetMinGateMultiple: number
  /** After an onset, ignore further rises for this long (the same pluck's attack). */
  onsetRefractoryMs: number
  /** The expected note counts as present when its match strength is at least this... */
  targetMinStrength: number
  /** ...and stronger than just before the pluck by this much (so a still-ringing string doesn't count). */
  targetMinRise: number
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  yin: DEFAULT_YIN_OPTIONS,
  recognizer: DEFAULT_RECOGNIZER_CONFIG,
  minClarity: 0.85,
  calibrationMs: 800,
  gateMultiplier: 3,
  // Laptop and phone microphones can be very quiet with automatic volume switched off,
  // so the lowest gate is small; the clarity check is what rejects noise.
  minGate: 0.001,
  // A low cap: a string ringing or rain during the quiet check must not make the app deaf.
  maxGate: 0.01,
  onsetRatio: 1.6,
  onsetMinGateMultiple: 1,
  onsetRefractoryMs: 60,
  // Blends of loud low strings measured 0.6–0.9 for the note just played (clean notes: >0.95).
  targetMinStrength: 0.6,
  targetMinRise: 0.05,
}

/** What the app heard in one frame, for display and diagnostics. */
export type PitchReading = {
  time: number
  frequency: number | null
  clarity: number
  rms: number
  /** True when the reading passed the noise gate and clarity check. */
  reliable: boolean
  /** Why an unreliable reading was ignored: too quiet, or not a clear note. */
  rejectReason: 'quiet' | 'unclear' | null
  /** Fractional MIDI pitch when reliable. */
  midi: number | null
  /** True when this reading is the start of a pluck. */
  onset: boolean
  /** True when the expected note was found in a blended sound (e.g. two strings ringing). */
  matchedTarget: boolean
}

type ExpectedNote = { midi: number; repeats: boolean; previousStrength: number; strengthBeforeOnset: number }

export type TrackerResult = {
  reading: PitchReading
  events: NoteEvent[]
  calibrating: boolean
}

export class PitchTracker {
  readonly sampleRate: number
  readonly frameSize: number
  private readonly config: TrackerConfig
  private readonly detect: PitchDetector
  private readonly recognizer: NoteRecognizer
  private calibrationStart: number | null = null
  private calibrationLevels: number[] = []
  private noiseGate: number
  /** Notes that may be played next: the current note first, then (in play-through mode) the next ones. */
  private targets: ExpectedNote[] = []
  private recentAttack: number[] = []
  private lastRms = 0
  /** Pitch of the last clear reading, to notice a different note after a gap. */
  private lastClearMidi: number | null = null
  private lastOnset = -Infinity
  /** The pluck (onset time) that has been shown to bring in an expected note, and which one. */
  private targetPluck: { onset: number; midi: number } | null = null

  constructor(sampleRate: number, frameSize: number, config: TrackerConfig = DEFAULT_TRACKER_CONFIG) {
    this.sampleRate = sampleRate
    this.frameSize = frameSize
    this.config = config
    this.detect = createPitchDetector(sampleRate, frameSize, config.yin)
    this.recognizer = new NoteRecognizer(config.recognizer)
    this.noiseGate = config.minGate
  }

  /** Current loudness threshold; quieter sounds are treated as silence. */
  get gate(): number {
    return this.noiseGate
  }

  /**
   * The note the student should play now (MIDI), or null. Lets the tracker recognise that
   * note even when another string is still ringing.
   */
  setTarget(midi: number | null) {
    this.setTargets(midi === null ? [] : [midi])
  }

  /**
   * The notes that may be played next, current note first. In play-through mode the next few
   * notes are included, so a note is still recognised if the student is ahead of the app.
   */
  setTargets(midis: readonly number[]) {
    const previousCurrent = this.targets[0]?.midi ?? null
    this.targets = midis.map((midi, i) => ({
      midi,
      // The current note has the same pitch as the previous one (a repeated note such as "21 21").
      repeats: i === 0 && midi === previousCurrent,
      previousStrength: 0,
      strengthBeforeOnset: 0,
    }))
    this.targetPluck = null
  }

  /**
   * `time` is in milliseconds. `afterGap` means frames were skipped just before this one (the
   * app was playing its error sound). A pluck made during the gap may have lost its sharp attack
   * by now, so it is recognised by the sound being clearly louder, or clearly a different note,
   * than before the gap. A wrong note that simply keeps ringing does not count again.
   */
  process(samples: Float32Array, time: number, { afterGap = false } = {}): TrackerResult {
    const frame = this.detect(samples)
    this.calibrationStart ??= time

    if (time - this.calibrationStart < this.config.calibrationMs) {
      this.calibrationLevels.push(frame.rms)
      this.recentAttack = [attackLevel(samples)]
      return {
        reading: { ...frame, time, reliable: false, rejectReason: null, midi: null, onset: false, matchedTarget: false },
        events: [],
        calibrating: true,
      }
    }
    if (this.calibrationLevels.length > 0) {
      // Use the quieter part of the check (20th percentile), so a short sound during it
      // (a ringing string, a knock) does not raise the gate.
      const sorted = [...this.calibrationLevels].sort((a, b) => a - b)
      const background = sorted[Math.floor((sorted.length - 1) * 0.2)]
      this.noiseGate = Math.min(this.config.maxGate, Math.max(this.config.minGate, background * this.config.gateMultiplier))
      this.calibrationLevels = []
    }

    // Pluck detection: a sudden rise in attack level compared with the last two readings.
    const attack = attackLevel(samples)
    const quietest = Math.min(...this.recentAttack)
    const loudEnough = frame.rms >= this.noiseGate * this.config.onsetMinGateMultiple
    const clearMidi = frame.rms >= this.noiseGate && frame.frequency !== null && frame.clarity >= this.config.minClarity ? frequencyToMidi(frame.frequency) : null
    const differentNote = clearMidi !== null && this.lastClearMidi !== null && Math.abs(clearMidi - this.lastClearMidi) > 0.5
    const onset = afterGap
      ? loudEnough && (frame.rms >= this.lastRms * GAP_ONSET_RATIO || differentNote)
      : loudEnough && attack >= quietest * this.config.onsetRatio && time - this.lastOnset >= this.config.onsetRefractoryMs
    if (clearMidi !== null) this.lastClearMidi = clearMidi
    this.recentAttack = afterGap ? [attack] : [...this.recentAttack, attack].slice(-2)
    this.lastRms = frame.rms
    if (onset) {
      this.lastOnset = time
      for (const target of this.targets) target.strengthBeforeOnset = target.previousStrength
    }

    let reading: PitchReading
    const blindReject =
      frame.rms < this.noiseGate
        ? 'quiet'
        : frame.frequency === null || frame.clarity < this.config.minClarity
          ? 'unclear'
          : null
    const blindMidi = blindReject === null ? frequencyToMidi(frame.frequency!) : null
    const target = this.matchTarget(frame.rms, time, blindMidi)
    if (target) {
      reading = {
        time,
        frequency: target.frequency,
        clarity: target.strength,
        rms: frame.rms,
        reliable: true,
        rejectReason: null,
        midi: frequencyToMidi(target.frequency),
        onset,
        matchedTarget: true,
      }
    } else {
      reading = { ...frame, time, reliable: blindReject === null, rejectReason: blindReject, midi: blindMidi, onset, matchedTarget: false }
    }

    const events = this.recognizer.push({ time, midi: reading.midi, rms: frame.rms, onset })
    return { reading, events, calibrating: false }
  }

  /**
   * With two strings ringing, the blended sound may give no clear pitch (or a lower "common"
   * pitch), although the expected note was just played. Checks for the expected note directly,
   * but only right after a pluck, and only if the pluck made it stronger, so a string that
   * was already ringing at that pitch never counts.
   */
  private matchTarget(rms: number, time: number, blindMidi: number | null) {
    const afterPluck = time - this.lastOnset <= this.config.recognizer.onsetWindowMs
    let found: PitchMatch | null = null
    // Every candidate's strength is measured each frame (needed for the "before the pluck" check).
    for (const target of this.targets) {
      const match = rms >= this.noiseGate ? this.detect.matchAt(midiToFrequency(target.midi), DEFAULT_MATCH_CONFIG.acceptCents) : null
      const strength = match?.strength ?? 0
      target.previousStrength = strength
      if (found || !match) continue

      const blindDisagrees = blindMidi === null || blindMidi < target.midi - 0.5 // unclear, or a lower "blend" pitch
      const strongEnough = strength >= this.config.targetMinStrength
      // For a repeated note the same pitch is still ringing from the previous pluck (usually on the
      // same string), so it cannot get "stronger"; the new pluck itself is the evidence.
      // Once this pluck has been shown to bring in the note, that holds for the rest of its
      // window, even as the note settles and its match weakens a little.
      const newlyPlayed =
        target.repeats ||
        (this.targetPluck?.onset === this.lastOnset && this.targetPluck.midi === target.midi) ||
        strength >= target.strengthBeforeOnset + this.config.targetMinRise
      if (afterPluck && blindDisagrees && strongEnough && newlyPlayed) {
        this.targetPluck = { onset: this.lastOnset, midi: target.midi }
        found = match
      }
    }
    return found
  }

  /** See NoteRecognizer.reset. */
  resetNotes(options?: { requireFreshOnset?: boolean }) {
    this.recognizer.reset(options)
  }
}

/** After a gap, the sound must be at least this much louder than before it to count as a pluck. */
const GAP_ONSET_RATIO = 1.25

/** Newest part of the frame used for the attack level (≈21 ms at 48 kHz). */
const ATTACK_SAMPLES = 1024

/**
 * Loudness of the bright part of the sound in the newest samples of the frame. Taking the
 * difference between neighbouring samples is a simple high-pass filter: it emphasises the
 * crisp start of a pluck over the mellow sound of strings that keep ringing.
 */
function attackLevel(samples: Float32Array): number {
  let sum = 0
  for (let i = samples.length - ATTACK_SAMPLES; i < samples.length; i++) {
    const change = samples[i] - samples[i - 1]
    sum += change * change
  }
  return Math.sqrt(sum / ATTACK_SAMPLES)
}

/**
 * Runs a recorded or generated signal through the tracker the same way the live app does
 * (a frame every `hopMs`). Used by tests and for checking recordings offline.
 */
export function analyseSignal(
  signal: Float32Array,
  sampleRate: number,
  { frameSize = 2048, hopMs = 25, config = DEFAULT_TRACKER_CONFIG, targetMidi = null as number | null } = {},
): { readings: PitchReading[]; events: NoteEvent[]; tracker: PitchTracker } {
  const tracker = new PitchTracker(sampleRate, frameSize, config)
  tracker.setTarget(targetMidi)
  const hop = Math.round((hopMs / 1000) * sampleRate)
  const readings: PitchReading[] = []
  const events: NoteEvent[] = []
  for (let end = frameSize; end <= signal.length; end += hop) {
    const time = (end / sampleRate) * 1000
    const result = tracker.process(signal.subarray(end - frameSize, end), time)
    readings.push(result.reading)
    events.push(...result.events)
  }
  return { readings, events, tracker }
}
