import { useCallback, useEffect, useRef, useState } from 'react'
import { ListeningSession, type ListeningStats, type ListeningStatus } from './listeningSession'
import type { MicrophoneErrorKind } from './microphone'
import type { NoteEvent } from './noteRecognizer'
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
  stop: () => void
  recordClip: (seconds: number) => Promise<{ samples: Float32Array; sampleRate: number }>
  resetNotes: (options?: { requireFreshOnset?: boolean }) => void
  /** Tells the detector which note is expected now (null when nothing is expected). */
  setTarget: (midi: number | null) => void
  /** Plays the wrong-note sound (and pauses detection while it plays). False if not listening. */
  playErrorSound: () => boolean
}

export function useListening(onNoteEvents: (events: NoteEvent[]) => void): ListeningState {
  const [status, setStatus] = useState<ListeningStatus>('idle')
  const [error, setError] = useState<MicrophoneErrorKind | null>(null)
  const [autoStopped, setAutoStopped] = useState(false)
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
        if (next === 'idle' || next === 'error') latest.current = { reading: null, stats: null }
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
  const recordClip = useCallback((seconds: number) => getSession().recordClip(seconds), [getSession])
  const stop = useCallback(() => getSession().stop(), [getSession])
  const setTarget = useCallback((midi: number | null) => getSession().setTarget(midi), [getSession])
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
    stop,
    recordClip,
    resetNotes,
    setTarget,
    playErrorSound,
  }
}
