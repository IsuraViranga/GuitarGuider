// Live listening in the browser: microphone → AnalyserNode → PitchTracker, ~40 times a second.
// Nothing is recorded: each 43 ms frame is analysed and immediately discarded.

import { MicrophoneError, requestMicrophone, type MicrophoneErrorKind } from './microphone'
import type { NoteEvent } from './noteRecognizer'
import { PitchTracker, type PitchReading } from './pitchTracker'

export const FRAME_SIZE = 2048
export const ANALYSIS_INTERVAL_MS = 25

/** The wrong-note sound: short, and two clashing tones so it is not heard as a guitar note. */
const ERROR_SOUND_SECONDS = 0.18
const ERROR_SOUND_TONES_HZ = [220, 233.08]
const ERROR_SOUND_VOLUME = 0.15
/** Detection pauses while the error sound plays, plus this much for echoes in the room. */
const ERROR_SOUND_ECHO_MS = 250

export type ListeningStatus = 'idle' | 'starting' | 'calibrating' | 'listening' | 'error'

export type ListeningStats = {
  sampleRate: number
  noiseGate: number
  /** Average time to analyse one frame; must stay well below ANALYSIS_INTERVAL_MS. */
  analysisMs: number
  framesPerSecond: number
}

export type ListeningCallbacks = {
  onStatus: (status: ListeningStatus, error?: MicrophoneErrorKind) => void
  onReading: (reading: PitchReading, stats: ListeningStats) => void
  onNoteEvents: (events: NoteEvent[]) => void
  /** Called when listening stopped by itself, e.g. the app went to the background. */
  onAutoStop?: (reason: 'hidden') => void
}

export class ListeningSession {
  private readonly callbacks: ListeningCallbacks
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private tracker: PitchTracker | null = null
  private targetMidi: number | null = null
  private source: MediaStreamAudioSourceNode | null = null
  /** Ends a test recording early if listening stops while it is running. */
  private finishRecording: (() => void) | null = null
  private wakeLock: WakeLockSentinel | null = null
  private lastAudioTime = -1
  /** Audio-clock time (ms) until which the microphone is ignored (while the app makes a sound). */
  private mutedUntil = 0
  private analysisTimes: number[] = []
  private frameTimes: number[] = []
  private status: ListeningStatus = 'idle'

  constructor(callbacks: ListeningCallbacks) {
    this.callbacks = callbacks
  }

  get isActive(): boolean {
    return this.status === 'starting' || this.status === 'calibrating' || this.status === 'listening'
  }

  /** Must be called from a tap/click: browsers only allow audio to start after a user action. */
  async start({ boost = false } = {}): Promise<void> {
    if (this.isActive) return
    this.setStatus('starting')
    // Create the AudioContext synchronously inside the tap, before any await (needed on phones).
    let context: AudioContext
    try {
      context = new AudioContext()
    } catch (error) {
      this.fail(new MicrophoneError('unsupported', error))
      return
    }
    this.context = context

    try {
      const stream = await requestMicrophone({ boost })
      if (this.context !== context) {
        // stop() was called while the permission prompt was open.
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      this.stream = stream
      stream.getAudioTracks()[0]?.addEventListener('ended', () => this.fail(new MicrophoneError('device-lost')))
      await context.resume()

      const analyser = context.createAnalyser()
      analyser.fftSize = FRAME_SIZE
      analyser.smoothingTimeConstant = 0
      this.source = context.createMediaStreamSource(stream)
      this.source.connect(analyser)
      // The analyser is not connected to the speakers: the student never hears the microphone.

      this.tracker = new PitchTracker(context.sampleRate, FRAME_SIZE)
      this.tracker.setTarget(this.targetMidi)
      const buffer = new Float32Array(FRAME_SIZE)
      this.lastAudioTime = -1
      this.timer = setInterval(() => this.analyse(analyser, buffer), ANALYSIS_INTERVAL_MS)
      document.addEventListener('visibilitychange', this.handleVisibility)
      this.setStatus('calibrating')
      void this.requestWakeLock()
    } catch (error) {
      this.fail(error instanceof MicrophoneError ? error : new MicrophoneError('unknown', error))
    }
  }

  stop(): void {
    this.release()
    this.setStatus('idle')
  }

  /**
   * Records the raw microphone signal for a few seconds, for checking detection offline.
   * Only used when the student explicitly asks for a test recording; it is kept in memory
   * and handed back to the page, never uploaded.
   */
  recordClip(seconds: number): Promise<{ samples: Float32Array; sampleRate: number }> {
    const context = this.context
    const source = this.source
    if (!context || !source) return Promise.reject(new Error('Start listening first.'))

    // ScriptProcessorNode is deprecated but supported everywhere and needs no extra file;
    // it is fine for a short diagnostic recording.
    const recorder = context.createScriptProcessor(4096, 1, 1)
    const silent = context.createGain()
    silent.gain.value = 0 // must reach the speakers to run, but at zero volume
    const chunks: Float32Array[] = []
    const needed = Math.round(seconds * context.sampleRate)
    let collected = 0

    return new Promise((resolve) => {
      const finish = () => {
        this.finishRecording = null
        recorder.onaudioprocess = null
        source.disconnect(recorder)
        recorder.disconnect()
        silent.disconnect()
        const samples = new Float32Array(Math.min(collected, needed))
        let offset = 0
        for (const chunk of chunks) {
          const part = chunk.subarray(0, samples.length - offset)
          samples.set(part, offset)
          offset += part.length
        }
        resolve({ samples, sampleRate: context.sampleRate })
      }
      recorder.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
        collected += event.inputBuffer.length
        if (collected >= needed) finish()
      }
      this.finishRecording = finish
      source.connect(recorder)
      recorder.connect(silent)
      silent.connect(context.destination)
    })
  }

  /**
   * Plays the short wrong-note sound through the same audio context as the microphone, and
   * ignores the microphone meanwhile so the app does not "hear" its own sound as a note.
   * Returns false when not listening.
   */
  playErrorSound(): boolean {
    const context = this.context
    if (!context || context.state !== 'running') return false
    const now = context.currentTime
    const end = now + ERROR_SOUND_SECONDS
    const volume = context.createGain()
    volume.gain.setValueAtTime(0, now)
    volume.gain.linearRampToValueAtTime(ERROR_SOUND_VOLUME, now + 0.01)
    volume.gain.exponentialRampToValueAtTime(0.001, end)
    volume.connect(context.destination)
    for (const frequency of ERROR_SOUND_TONES_HZ) {
      const tone = context.createOscillator()
      tone.type = 'square'
      tone.frequency.value = frequency
      tone.connect(volume)
      tone.start(now)
      tone.stop(end)
      tone.onended = () => tone.disconnect()
    }
    setTimeout(() => volume.disconnect(), (ERROR_SOUND_SECONDS + 0.1) * 1000)
    this.mutedUntil = end * 1000 + ERROR_SOUND_ECHO_MS
    return true
  }

  /** The note the student should play now, so it can be recognised among ringing strings. */
  setTarget(midi: number | null): void {
    this.targetMidi = midi
    this.tracker?.setTarget(midi)
  }

  /** Forget pending note detection, e.g. after the student jumps to another note. */
  resetNotes(options?: { requireFreshOnset?: boolean }): void {
    this.tracker?.resetNotes(options)
  }

  private analyse(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>) {
    const context = this.context
    const tracker = this.tracker
    if (!context || !tracker) return
    // Skip if no new audio arrived since the last frame (would count the same sound twice).
    if (context.currentTime === this.lastAudioTime) return
    this.lastAudioTime = context.currentTime
    if (context.currentTime * 1000 < this.mutedUntil) return

    const started = performance.now()
    analyser.getFloatTimeDomainData(buffer)
    const result = tracker.process(buffer, context.currentTime * 1000)
    this.recordTiming(started)

    if (!result.calibrating && this.status === 'calibrating') this.setStatus('listening')
    this.callbacks.onReading(result.reading, {
      sampleRate: context.sampleRate,
      noiseGate: tracker.gate,
      analysisMs: average(this.analysisTimes),
      framesPerSecond: this.frameTimes.length > 1 ? (1000 * (this.frameTimes.length - 1)) / (this.frameTimes.at(-1)! - this.frameTimes[0]) : 0,
    })
    if (result.events.length > 0) this.callbacks.onNoteEvents(result.events)
  }

  private recordTiming(started: number) {
    const now = performance.now()
    this.analysisTimes.push(now - started)
    this.frameTimes.push(now)
    if (this.analysisTimes.length > 40) this.analysisTimes.shift()
    if (this.frameTimes.length > 40) this.frameTimes.shift()
  }

  private handleVisibility = () => {
    if (document.visibilityState === 'hidden' && this.isActive) {
      this.stop()
      this.callbacks.onAutoStop?.('hidden')
    }
  }

  /** Keeps the phone screen on while listening (where supported). */
  private async requestWakeLock() {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      // Not supported or refused (e.g. battery saver). Listening still works.
    }
  }

  private fail(error: MicrophoneError) {
    this.release()
    this.setStatus('error', error.kind)
  }

  private release() {
    this.finishRecording?.()
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    document.removeEventListener('visibilitychange', this.handleVisibility)
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    void this.context?.close().catch(() => {})
    this.context = null
    this.tracker = null
    this.source = null
    void this.wakeLock?.release().catch(() => {})
    this.wakeLock = null
    this.analysisTimes = []
    this.frameTimes = []
    this.mutedUntil = 0
  }

  private setStatus(status: ListeningStatus, error?: MicrophoneErrorKind) {
    this.status = status
    this.callbacks.onStatus(status, error)
  }
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}
