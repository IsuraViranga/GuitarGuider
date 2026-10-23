import { useCallback, useEffect, useRef, useState } from 'react'
import { ListeningSession, type ListeningStats, type ListeningStatus, type PracticeRecording } from './listeningSession'
import type { MicrophoneErrorKind } from './microphone'
import type { DetectedEvent } from './pitchTracker'
import type { PitchReading } from './pitchTracker'

/** How often live readings are copied to the screen. Detection itself runs faster. */
const DISPLAY_INTERVAL_MS = 100

export type ListeningState = {
  status: ListeningStatus
  error: MicrophoneErrorKind | null
  /** Set when listening stopped by itself (app went to the background). */
  autoStopped: boolean
  reading: PitchReading | null
  stats: ListeningStats | null
  start: (options?: { boost?: boolean }) => void
  /** Test mode: play an audio file and analyse it instead of the microphone. */
  startFromFile: (file: Blob) => void
  stop: () => void
  /** True while a diagnostic practice recording is running. */
  recording: boolean
  startRecording: (maxSeconds: number) => boolean
  /** Stops the recording (or returns one interrupted by listening stopping). */
  stopRecording: () => PracticeRecording | null
  /** Adds an app decision to the practice recording log (ignored when not recording). */
  logEvent: (kind: string, data?: Record<string, unknown>) => void
  resetNotes: (options?: { requireFreshOnset?: boolean }) => void
  /** Tells the detector which notes may come next, current note first (empty: nothing expected). */
  setTargets: (midis: readonly number[]) => void
  /** Tells the detector which chords may be strummed next (null for single-note steps). */
  setChordTargets: (chords: readonly (readonly number[] | null)[]) => void
  /** Plays the wrong-note sound (and pauses detection while it plays). False if not listening. */
  playErrorSound: () => boolean
}

export function useListening(onNoteEvents: (events: DetectedEvent[]) => void): ListeningState {
  const [status, setStatus] = useState<ListeningStatus>('idle')
  const [error, setError] = useState<MicrophoneErrorKind | null>(null)
  const [autoStopped, setAutoStopped] = useState(false)
  const [recording, setRecording] = useState(false)
  const [display, setDisplay] = useState<{ reading: PitchReading | null; stats: ListeningStats | null }>({
    reading: null,
    stats: null,
  })

  const latest = useRef<{ reading: PitchReading | null; stats: ListeningStats | null }>({ reading: null, stats: null })
  const onNoteEventsRef = useRef(onNoteEvents)
  useEffect(() => {
    onNoteEventsRef.current = onNoteEvents
  })

  const sessionRef = useRef<ListeningSession | null>(null)
  const getSession = useCallback(() => {
    sessionRef.current ??= new ListeningSession({
      onStatus: (next, kind) => {
        setStatus(next)
        setError(kind ?? null)
        if (next === 'idle' || next === 'error') {
          latest.current = { reading: null, stats: null }
          setRecording(false)
        }
      },
      onReading: (reading, stats) => {
        latest.current = { reading, stats }
      },
      onNoteEvents: (events) => onNoteEventsRef.current(events),
      onAutoStop: () => setAutoStopped(true),
    })
    return sessionRef.current
  }, [])

  // Stop the microphone when leaving the page.
  useEffect(() => () => sessionRef.current?.stop(), [])

  const active = status === 'starting' || status === 'calibrating' || status === 'listening'
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setDisplay(latest.current), DISPLAY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active])

  const start = useCallback(
    (options?: { boost?: boolean }) => {
      setAutoStopped(false)
      void getSession().start(options)
    },
    [getSession],
  )
  const startFromFile = useCallback(
    (file: Blob) => {
      setAutoStopped(false)
      void getSession().startFromFile(file)
    },
    [getSession],
  )
  const startRecording = useCallback(
    (maxSeconds: number) => {
      const started = getSession().startRecording(maxSeconds)
      setRecording(started)
      return started
    },
    [getSession],
  )
  const stopRecording = useCallback(() => {
    setRecording(false)
    return getSession().stopRecording()
  }, [getSession])
  const logEvent = useCallback(
    (kind: string, data?: Record<string, unknown>) => sessionRef.current?.logEvent(kind, data),
    [],
  )
  const stop = useCallback(() => getSession().stop(), [getSession])
  const setTargets = useCallback((midis: readonly number[]) => getSession().setTargets(midis), [getSession])
  const setChordTargets = useCallback(
    (chords: readonly (readonly number[] | null)[]) => getSession().setChordTargets(chords),
    [getSession],
  )
  const playErrorSound = useCallback(() => sessionRef.current?.playErrorSound() ?? false, [])
  const resetNotes = useCallback((options?: { requireFreshOnset?: boolean }) => sessionRef.current?.resetNotes(options), [])

  // Old readings are hidden as soon as listening stops.
  return {
    status,
    error,
    autoStopped,
    reading: active ? display.reading : null,
    stats: active ? display.stats : null,
    start,
    startFromFile,
    stop,
    recording,
    startRecording,
    stopRecording,
    logEvent,
    resetNotes,
    setTargets,
    setChordTargets,
    playErrorSound,
  }
}
