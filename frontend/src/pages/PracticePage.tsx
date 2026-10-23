import { useCallback, useEffect, useReducer, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { Fretboard } from '../components/fretboard/Fretboard'
import type { NoteEvent } from '../audio/noteRecognizer'
import { useListening } from '../audio/useListening'
import { ListeningPanel } from '../components/listening/ListeningPanel'
import { FeedbackBanner } from '../components/practice/FeedbackBanner'
import { NoteTimeline } from '../components/timeline/NoteTimeline'
import { STANDARD_TUNING, getTuning } from '../music/tuning'
import { describeNote, noteAccessibleLabel } from '../songs/describeNote'
import type { Song } from '../songs/types'
import { useSong } from '../songs/useSong'
import { validateSong } from '../songs/validation'
import {
  createPracticeState,
  FLOW_LOOKAHEAD,
  isFirstNote,
  isLastNote,
  practiceReducer,
} from '../practice/practiceReducer'
import { useErrorSoundSetting, useMicBoostSetting, usePracticeModeSetting } from '../practice/usePracticeSettings'
import { midiToNoteName } from '../music/pitch'
import { SongStatus } from './SongStatus'
import styles from './PracticePage.module.css'

export function PracticePage() {
  const { songId } = useParams()
  const state = useSong(songId)
  const song = state.status === 'ready' ? state.value : undefined
  usePageTitle(song ? `Practise ${song.title}` : 'Practice')

  if (!song) return <SongStatus state={state} />
  if (validateSong(song).length > 0) {
    return (
      <div className="page stack">
        <h1>{song.title}</h1>
        <p className="error-box" role="alert">
          This song has problems that must be fixed before practice.{' '}
          <Link to={`/songs/${song.id}`}>See the details</Link>.
        </p>
      </div>
    )
  }
  return <PracticeView key={song.id} song={song} />
}

/** At most one error sound in this period, even if several wrong notes are played quickly. */
const ERROR_SOUND_COOLDOWN_MS = 800

function PracticeView({ song }: { song: Song }) {
  const [mode, setMode] = usePracticeModeSetting()
  const [practice, dispatch] = useReducer(practiceReducer, song.notes, (notes) =>
    createPracticeState(
      notes.map((n) => n.midi),
      notes.map((n) => n.position?.stringNumber ?? null),
      mode,
    ),
  )
  const changeMode = (value: typeof mode) => {
    setMode(value)
    dispatch({ type: 'setMode', mode: value })
  }
  const [errorSound, setErrorSound] = useErrorSoundSetting()
  const [boost, setBoost] = useMicBoostSetting()

  const handleNoteEvents = useCallback((events: NoteEvent[]) => {
    for (const event of events) dispatch({ type: 'noteEvent', event })
  }, [])
  const listening = useListening(handleNoteEvents)
  const { resetNotes, setTargets, playErrorSound } = listening
  const isListening = listening.status === 'listening' || listening.status === 'calibrating'
  const micActive = isListening || listening.status === 'starting'

  // Every position change (a correct note, or Back/Next/Restart/jump): ignore any note still
  // ringing, so it can't count for the new target, and tell the detector what to listen for.
  // The microphone keeps running.
  const targetMidi = practice.completed ? null : practice.targets[practice.currentIndex]
  const lookahead = practice.mode === 'flow' ? FLOW_LOOKAHEAD : 0
  const expected = practice.completed ? '' : practice.targets.slice(practice.currentIndex, practice.currentIndex + 1 + lookahead).join(',')
  useEffect(() => {
    resetNotes({ requireFreshOnset: true })
    setTargets(expected ? expected.split(',').map(Number) : [])
  }, [practice.positionVersion, expected, resetNotes, setTargets])

  // Practice decisions go into a diagnostic practice recording, if one is running.
  const { logEvent } = listening
  useEffect(() => {
    const { feedback } = practice
    logEvent('practice', {
      index: practice.currentIndex,
      target: targetMidi,
      feedback: feedback.kind,
      ...(feedback.kind === 'incorrect' ? { heard: Number(feedback.detectedMidi.toFixed(2)), octaveOff: feedback.octaveOff } : {}),
      ...(feedback.kind === 'correct' ? { cents: Math.round(feedback.cents) } : {}),
      completed: practice.completed,
    })
    // Log once per new decision or position change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice.feedbackId, practice.positionVersion])

  // One short sound per confirmed wrong note. Never a sound for correct notes.
  const lastErrorSound = useRef(-Infinity)
  useEffect(() => {
    if (practice.feedback.kind !== 'incorrect' || !errorSound) return
    const now = performance.now()
    if (now - lastErrorSound.current < ERROR_SOUND_COOLDOWN_MS) return
    if (playErrorSound()) lastErrorSound.current = now
    // Only a new feedback (feedbackId) should trigger the sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice.feedbackId])

  const tuning = getTuning(song.tuningId) ?? STANDARD_TUNING
  const note = song.notes[practice.currentIndex]
  const text = describeNote(note)
  const upcoming = song.notes.slice(practice.currentIndex + 1, practice.currentIndex + 5)
  const heard = listening.reading?.reliable && listening.reading.midi !== null ? listening.reading.midi : null

  return (
    <div className={`page ${styles.layout}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>{song.title}</h1>
        <p className={styles.progress} data-testid="progress">
          Note <strong>{practice.currentIndex + 1}</strong> of {song.notes.length}
        </p>
      </header>

      <fieldset className={styles.mode}>
        <legend className="visually-hidden">Practice mode</legend>
        <div className={styles.modeSwitch}>
          <label className={styles.modeOption}>
            <input type="radio" name="mode" checked={practice.mode === 'strict'} onChange={() => changeMode('strict')} />
            <span>Note by note</span>
          </label>
          <label className={styles.modeOption}>
            <input type="radio" name="mode" checked={practice.mode === 'flow'} onChange={() => changeMode('flow')} />
            <span>Play through</span>
          </label>
        </div>
        <p className={styles.modeHint}>
          {practice.mode === 'strict' ? 'Waits on each note until you play it.' : 'Keeps up when you play the song at speed.'}
        </p>
      </fieldset>

      {/* Announces the new target to screen readers whenever the position changes. */}
      <p role="status" className="visually-hidden" data-testid="position-status">
        {noteAccessibleLabel(note, song.notes.length)}
        {isLastNote(practice) ? '. Last note.' : ''}
      </p>

      <section className={`card ${styles.target}`} aria-labelledby="target-heading">
        <FeedbackBanner
          practice={practice}
          notes={song.notes}
          listening={isListening}
          onRestart={() => dispatch({ type: 'reset' })}
        />
        <h2 id="target-heading" className={styles.targetHeading}>
          {practice.completed ? 'Last note' : 'Play next'}
        </h2>
        <p className={styles.number} data-testid="expected-number">
          {text.number}
        </p>
        <p className={styles.upcoming} data-testid="upcoming">
          {practice.completed
            ? ''
            : upcoming.length > 0
              ? <>Then: <strong>{upcoming.map((n, i) => describeNote(n).number + (i === 0 && describeNote(n).number === text.number ? ' again' : '')).join(' · ')}</strong></>
              : 'Last note of the song'}
        </p>
        <p className={styles.targetDetails}>
          <span>
            {text.position}
            {note.position?.stringNumber === 1 && <strong> · thinnest string</strong>}
            {note.position?.stringNumber === 6 && <strong> · thickest string</strong>}
          </span>
          <span>
            Note <strong>{text.noteName}</strong> · {text.frequency}
          </span>
        </p>
        <p className={styles.micLine} data-testid="mic-line">
          <span aria-hidden="true">🎤 </span>
          {listening.status === 'listening' && <>Listening{heard !== null && <> · hearing <strong>{midiToNoteName(Math.round(heard)).label}</strong></>}</>}
          {listening.status === 'calibrating' && 'Measuring background noise… keep quiet'}
          {listening.status === 'starting' && 'Starting the microphone…'}
          {listening.status === 'idle' && 'Microphone off. Tap “Listen” to start.'}
          {listening.status === 'error' && 'Microphone not available. See “Listening” below.'}
        </p>
        <Fretboard position={note.position} tuning={tuning} />
      </section>

      <div className={styles.controls} role="group" aria-label="Practice controls">
        <button
          type="button"
          className="button"
          onClick={() => dispatch({ type: 'previous' })}
          disabled={isFirstNote(practice)}
        >
          <span aria-hidden="true">◀</span> Back
        </button>
        {micActive ? (
          <button type="button" className="button" onClick={listening.stop}>
            <span aria-hidden="true">❚❚</span> Pause
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary"
            onClick={() => listening.start({ boost })}
          >
            <span aria-hidden="true">🎤</span> Listen
          </button>
        )}
        <button
          type="button"
          className="button"
          onClick={() => dispatch({ type: 'next' })}
          disabled={isLastNote(practice)}
        >
          <span aria-hidden="true">▶</span> Next
        </button>
        <button
          type="button"
          className="button"
          onClick={() => dispatch({ type: 'reset' })}
          disabled={isFirstNote(practice) && !practice.completed}
        >
          <span aria-hidden="true">↺</span> Restart
        </button>
      </div>

      <div className={styles.listening}>
        <ListeningPanel
          listening={listening}
          errorSound={errorSound}
          onErrorSoundChange={setErrorSound}
          boost={boost}
          onBoostChange={setBoost}
        />
      </div>

      <section className={styles.timeline} aria-labelledby="timeline-heading">
        <h2 id="timeline-heading">All notes</h2>
        <p className="muted">Choose any note to jump to it.</p>
        <NoteTimeline
          notes={song.notes}
          currentIndex={practice.currentIndex}
          onSelect={(index) => dispatch({ type: 'jumpTo', index })}
        />
      </section>
    </div>
  )
}
