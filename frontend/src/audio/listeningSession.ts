// Live listening in the browser: microphone → AnalyserNode → PitchTracker, ~40 times a second.
// Nothing is recorded: each 43 ms frame is analysed and immediately discarded, unless the
// student explicitly starts a diagnostic practice recording.

import { MicrophoneError, requestMicrophone, type MicrophoneErrorKind } from './microphone'
import { CHORD_FRAME_SIZE } from './chroma'
import { DEFAULT_TRACKER_CONFIG, PitchTracker, type DetectedEvent, type PitchReading } from './pitchTracker'

export const FRAME_SIZE = 2048
export const ANALYSIS_INTERVAL_MS = 25

/** The wrong-note sound: short, and two clashing tones so it is not heard as a guitar note. */
const ERROR_SOUND_SECONDS = 0.12
const ERROR_SOUND_TONES_HZ = [220, 233.08]
const ERROR_SOUND_VOLUME = 0.15
/** Detection pauses while the error sound plays, plus this much for echoes in the room. */
const ERROR_SOUND_ECHO_MS = 120
/** Spoken guidance: the microphone is ignored while the phone talks, at most this long (in case "end" never comes). */
const SPEECH_MUTE_MAX_MS = 5000
/** ...and a little after, while the room echo fades. */
const SPEECH_ECHO_MS = 150

export type ListeningStatus = 'idle' | 'starting' | 'calibrating' | 'listening' | 'error'

export type ListeningStats = {
  sampleRate: number
  noiseGate: number
  /** Average time to analyse one frame; must stay well below ANALYSIS_INTERVAL_MS. */
  analysisMs: number
  framesPerSecond: number
}

/** One analysed frame in a practice recording log (times in ms from the recording start). */
export type LoggedFrame = {
  t: number
  hz: number | null
  clarity: number
  rms: number
  midi: number | null
  reliable: boolean
  onset: boolean
  matchedTarget: boolean
  target: number | null
  muted?: boolean
}

export type LoggedEvent = { t: number; kind: string; [key: string]: unknown }

export type PracticeRecording = {
  samples: Float32Array
  sampleRate: number
  log: {
    createdAt: string
    userAgent: string
    sampleRate: number
    frameSize: number
    intervalMs: number
    frames: LoggedFrame[]
    events: LoggedEvent[]
  }
}

type ActiveRecording = {
  processor: ScriptProcessorNode
  silent: GainNode
  chunks: Float32Array[]
  collected: number
  maxSamples: number
  startAudioTime: number | null
  frames: LoggedFrame[]
  events: LoggedEvent[]
}

export type ListeningCallbacks = {
  onStatus: (status: ListeningStatus, error?: MicrophoneErrorKind) => void
  onReading: (reading: PitchReading, stats: ListeningStats) => void
  onNoteEvents: (events: DetectedEvent[]) => void
  /** Called when listening stopped by itself, e.g. the app went to the background. */
  onAutoStop?: (reason: 'hidden') => void
}

export class ListeningSession {
  private readonly callbacks: ListeningCallbacks
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private tracker: PitchTracker | null = null
  private targets: readonly number[] = []
  private chordTargets: readonly (readonly number[] | null)[] = []
  /** Where the sound comes from: the microphone, or an audio file being played (test mode). */
  private source: AudioNode | null = null
  private fileSource: AudioBufferSourceNode | null = null
  private recording: ActiveRecording | null = null
  /** A recording that was still running when listening stopped, kept so it can be saved. */
  private interruptedRecording: PracticeRecording | null = null
  private lastSampleRate = 48000
  private wakeLock: WakeLockSentinel | null = null
  private lastAudioTime = -1
  /** Audio-clock time (ms) until which the microphone is ignored (while the app makes a sound). */
  private mutedUntil = 0
  /** True after frames were skipped (while the app made a sound): the next frame resumes after a gap. */
  private resumingAfterGap = false
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

      // The analyser is not connected to the speakers: the student never hears the microphone.
      this.beginAnalysis(context, context.createMediaStreamSource(stream), new PitchTracker(context.sampleRate, FRAME_SIZE))
      this.setStatus('calibrating')
    } catch (error) {
      this.fail(error instanceof MicrophoneError ? error : new MicrophoneError('unknown', error))
    }
  }

  /**
   * Test mode: plays an audio file (e.g. an expert's recording of the song) out loud and analyses
   * the file's sound directly instead of the microphone, exactly as if it were being played live.
   * Must be called from a user action. Stops by itself when the file ends.
   */
  async startFromFile(file: Blob): Promise<void> {
    if (this.isActive) return
    this.setStatus('starting')
    let context: AudioContext
    try {
      context = new AudioContext()
    } catch (error) {
      this.fail(new MicrophoneError('unsupported', error))
      return
    }
    this.context = context
    try {
      const audio = await context.decodeAudioData(await file.arrayBuffer())
      if (this.context !== context) return
      await context.resume()
      const player = context.createBufferSource()
      player.buffer = audio
      player.connect(context.destination) // so the student hears the recording
      player.onended = () => {
        if (this.fileSource === player) this.stop()
      }
      this.fileSource = player
      // A recording has no quiet start to measure the room, so the lowest noise gate is used.
      const tracker = new PitchTracker(context.sampleRate, FRAME_SIZE, { ...DEFAULT_TRACKER_CONFIG, calibrationMs: 0 })
      this.beginAnalysis(context, player, tracker)
      player.start()
      this.setStatus('listening')
    } catch (error) {
      this.fail(new MicrophoneError('unreadable-file', error))
    }
  }

  /** True while an audio file is being analysed instead of the microphone. */
  get isFileTest(): boolean {
    return this.fileSource !== null
  }

  private beginAnalysis(context: AudioContext, source: AudioNode, tracker: PitchTracker) {
    const analyser = context.createAnalyser()
    // The longer chord slice; single-note detection uses its newest FRAME_SIZE samples.
    analyser.fftSize = CHORD_FRAME_SIZE
    analyser.smoothingTimeConstant = 0
    this.source = source
    source.connect(analyser)
    this.tracker = tracker
    tracker.setTargets(this.targets)
    tracker.setChordTargets(this.chordTargets)
    const buffer = new Float32Array(CHORD_FRAME_SIZE)
    this.lastAudioTime = -1
    this.timer = setInterval(() => this.analyse(analyser, buffer), ANALYSIS_INTERVAL_MS)
    document.addEventListener('visibilitychange', this.handleVisibility)
    void this.requestWakeLock()
  }

  stop(): void {
    this.release()
    this.setStatus('idle')
  }

  get isRecording(): boolean {
    return this.recording !== null
  }

  /**
   * Starts a diagnostic practice recording: the raw microphone sound plus a log of every
   * reading and decision, so detection can be checked against what was really played.
   * Only started when the student asks for it; it stays in memory until stopRecording().
   */
  startRecording(maxSeconds: number): boolean {
    const context = this.context
    const source = this.source
    if (!context || !source || this.recording) return false
    this.interruptedRecording = null

    // ScriptProcessorNode is deprecated but supported everywhere and needs no extra file;
    // it is fine for a diagnostic recording.
    const processor = context.createScriptProcessor(4096, 1, 1)
    const silent = context.createGain()
    silent.gain.value = 0 // must reach the speakers to run, but at zero volume
    const recording: ActiveRecording = {
      processor,
      silent,
      chunks: [],
      collected: 0,
      maxSamples: Math.round(maxSeconds * context.sampleRate),
      startAudioTime: null,
      frames: [],
      events: [],
    }
    processor.onaudioprocess = (event) => {
      // The first block started one block before "now" on the audio clock.
      recording.startAudioTime ??= context.currentTime * 1000 - (event.inputBuffer.duration * 1000)
      if (recording.collected >= recording.maxSamples) return
      recording.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      recording.collected += event.inputBuffer.length
    }
    source.connect(processor)
    processor.connect(silent)
    silent.connect(context.destination)
    this.recording = recording
    return true
  }

  /** Stops the practice recording and returns the sound and the log (null if none was running). */
  stopRecording(): PracticeRecording | null {
    if (!this.recording && this.interruptedRecording) {
      const kept = this.interruptedRecording
      this.interruptedRecording = null
      return kept
    }
    const recording = this.recording
    const context = this.context
    if (!recording) return null
    this.recording = null
    recording.processor.onaudioprocess = null
    this.source?.disconnect(recording.processor)
    recording.processor.disconnect()
    recording.silent.disconnect()

    const samples = new Float32Array(Math.min(recording.collected, recording.maxSamples))
    let offset = 0
    for (const chunk of recording.chunks) {
      const part = chunk.subarray(0, samples.length - offset)
      samples.set(part, offset)
      offset += part.length
    }
    const start = recording.startAudioTime ?? 0
    const relative = <T extends { t: number }>(items: T[]) =>
      items.filter((item) => item.t >= start).map((item) => ({ ...item, t: Math.round(item.t - start) }))
    return {
      samples,
      sampleRate: context?.sampleRate ?? this.lastSampleRate,
      log: {
        createdAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        sampleRate: context?.sampleRate ?? this.lastSampleRate,
        frameSize: FRAME_SIZE,
        intervalMs: ANALYSIS_INTERVAL_MS,
        frames: relative(recording.frames),
        events: relative(recording.events),
      },
    }
  }

  /** Adds an app decision (e.g. "correct", "moved to note 5") to the practice recording log. */
  logEvent(kind: string, data: Record<string, unknown> = {}): void {
    if (!this.recording || !this.context) return
    this.recording.events.push({ t: this.context.currentTime * 1000, kind, ...data })
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
    // In file test mode the app listens to the file, not the room, so it cannot hear itself.
    const listeningToRoom = this.fileSource === null
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
    if (listeningToRoom) this.mutedUntil = end * 1000 + ERROR_SOUND_ECHO_MS
    return true
  }

  /**
   * Spoken guidance: while the app talks, ignore the microphone so its own voice is not heard
   * as a played note. Call with true when speech starts and false when it ends.
   */
  setSpeaking(speaking: boolean): void {
    const context = this.context
    // In file test mode the app listens to the file, not the room, so it cannot hear itself.
    if (!context || this.fileSource !== null) return
    const now = context.currentTime * 1000
    this.mutedUntil = now + (speaking ? SPEECH_MUTE_MAX_MS : SPEECH_ECHO_MS)
  }

  /**
   * The notes the student may play next (current note first), so they can be recognised among
   * ringing strings. Empty when nothing is expected.
   */
  setTargets(midis: readonly number[]): void {
    this.targets = midis
    this.tracker?.setTargets(midis)
  }

  /** The chords that may be strummed next (index 0 = current step; null for single-note steps). */
  setChordTargets(chords: readonly (readonly number[] | null)[]): void {
    this.chordTargets = chords
    this.tracker?.setChordTargets(chords)
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
    if (context.currentTime * 1000 < this.mutedUntil) {
      this.resumingAfterGap = true
      this.recording?.frames.push({ t: context.currentTime * 1000, hz: null, clarity: 0, rms: 0, midi: null, reliable: false, onset: false, matchedTarget: false, target: this.targets[0] ?? null, muted: true })
      return
    }

    const started = performance.now()
    analyser.getFloatTimeDomainData(buffer)
    const result = tracker.process(buffer, context.currentTime * 1000, { afterGap: this.resumingAfterGap })
    this.resumingAfterGap = false
    this.recordTiming(started)
    if (this.recording) {
      const r = result.reading
      const round = (value: number, digits: number) => Number(value.toFixed(digits))
      this.recording.frames.push({
        t: r.time,
        hz: r.frequency === null ? null : round(r.frequency, 2),
        clarity: round(r.clarity, 3),
        rms: round(r.rms, 5),
        midi: r.midi === null ? null : round(r.midi, 2),
        reliable: r.reliable,
        onset: r.onset,
        matchedTarget: r.matchedTarget,
        target: this.targets[0] ?? null,
      })
      for (const event of result.events) this.logEventAt(r.time, event.type, { noteId: event.noteId, midi: round(event.midi, 2) })
      for (const event of result.chordEvents) this.logEventAt(r.time, event.type, { ...event })
    }

    if (!result.calibrating && this.status === 'calibrating') this.setStatus('listening')
    this.callbacks.onReading(result.reading, {
      sampleRate: context.sampleRate,
      noiseGate: tracker.gate,
      analysisMs: average(this.analysisTimes),
      framesPerSecond: this.frameTimes.length > 1 ? (1000 * (this.frameTimes.length - 1)) / (this.frameTimes.at(-1)! - this.frameTimes[0]) : 0,
    })
    const detected: DetectedEvent[] = [...result.events, ...result.chordEvents]
    if (detected.length > 0) this.callbacks.onNoteEvents(detected)
  }

  private logEventAt(t: number, kind: string, data: Record<string, unknown>) {
    this.recording?.events.push({ t, kind, ...data })
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
    // A recording still running when listening stops is kept so it can still be saved.
    if (this.recording) this.interruptedRecording = this.stopRecording()
    if (this.context) this.lastSampleRate = this.context.sampleRate
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    document.removeEventListener('visibilitychange', this.handleVisibility)
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    const player = this.fileSource
    this.fileSource = null
    try {
      player?.stop()
    } catch {
      // Already stopped.
    }
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
