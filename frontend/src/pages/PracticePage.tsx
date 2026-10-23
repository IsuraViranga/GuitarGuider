import { useCallback, useEffect, useReducer, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { Fretboard } from '../components/fretboard/Fretboard'
import type { DetectedEvent } from '../audio/pitchTracker'
import { useListening } from '../audio/useListening'
import { ListeningPanel } from '../components/listening/ListeningPanel'
import { Celebration } from '../components/decor/Celebration'
import { LevelBars } from '../components/decor/LevelBars'
import { FeedbackBanner } from '../components/practice/FeedbackBanner'
import { NoteTimeline } from '../components/timeline/NoteTimeline'
import { STANDARD_TUNING, getTuning } from '../music/tuning'
import { describeNote, noteAccessibleLabel, shortLabel } from '../songs/describeNote'
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
      notes.map((n) => n.chord?.tones.map((t) => ({ midi: t.midi, string: t.position.stringNumber })) ?? null),
    ),
  )
  const changeMode = (value: typeof mode) => {
    setMode(value)
    dispatch({ type: 'setMode', mode: value })
  }
  const [errorSound, setErrorSound] = useErrorSoundSetting()
  const [boost, setBoost] = useMicBoostSetting()

  const handleNoteEvents = useCallback((events: DetectedEvent[]) => {
    for (const event of events) {
      if (event.type === 'chordStart' || event.type === 'chordWrong') dispatch({ type: 'chordEvent', event })
      else dispatch({ type: 'noteEvent', event })
    }
  }, [])
  const listening = useListening(handleNoteEvents)
  const { resetNotes, setTargets, setChordTargets, playErrorSound } = listening
  const isListening = listening.status === 'listening' || listening.status === 'calibrating'
  const micActive = isListening || listening.status === 'starting'

  // Every position change (a correct note, or Back/Next/Restart/jump): ignore any note still
  // ringing, so it can't count for the new target, and tell the detector what to listen for.
  // The microphone keeps running.
  const targetMidi = practice.completed ? null : practice.targets[practice.currentIndex]
  const lookahead = practice.mode === 'flow' ? FLOW_LOOKAHEAD : 0
  // Notes the detector should listen for: the current step (all notes of a chord) and, in
  // play-through mode, the next step(s).
  const coming = practice.completed ? [] : song.notes.slice(practice.currentIndex, practice.currentIndex + 1 + lookahead)
  const expected = coming.filter((n) => !n.chord).map((n) => n.midi).join(',')
  const expectedChords = JSON.stringify(coming.map((n) => n.chord?.tones.map((t) => t.midi) ?? null))
  useEffect(() => {
    resetNotes({ requireFreshOnset: true })
    setTargets(expected ? expected.split(',').map(Number) : [])
    setChordTargets(JSON.parse(expectedChords) as (number[] | null)[])
  }, [practice.positionVersion, expected, expectedChords, resetNotes, setTargets, setChordTargets])

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
    if ((practice.feedback.kind !== 'incorrect' && practice.feedback.kind !== 'wrong-chord') || !errorSound) return
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
      {practice.completed && <Celebration key={practice.feedbackId} />}
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
        {note.chord ? (
          <>
            <p className={styles.number} data-testid="expected-number">
              {note.chord.name ?? 'Chord'}
            </p>
            <p className={styles.chordNumbers} data-testid="expected-chord-numbers">
              {text.number}
            </p>
          </>
        ) : (
          <p className={styles.number} data-testid="expected-number">
            {text.number}
          </p>
        )}
        {note.lyric && (
          <p className={styles.lyric} data-testid="lyric">
            <span aria-hidden="true">♪ </span>
            {note.lyric}
          </p>
        )}
        <p className={styles.upcoming} data-testid="upcoming">
          {practice.completed
            ? ''
            : upcoming.length > 0
              ? <>Then: <strong>{upcoming.map((n, i) => shortLabel(n) + (i === 0 && shortLabel(n) === shortLabel(note) ? ' again' : '')).join(' · ')}</strong></>
              : 'Last note of the song'}
        </p>
        {note.chord ? (
          <p className={styles.targetDetails}>
            <span>Strum these {note.chord.tones.length} strings together</span>
            {note.chord.simplifiedFrom && <span className="muted">{note.chord.simplifiedFrom} (easier shape)</span>}
          </p>
        ) : (
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
        )}
        <p className={styles.micLine} data-testid="mic-line">
          <span aria-hidden="true">🎤 </span>
          {listening.status === 'listening' && (
            <>
              Listening
              <LevelBars rms={listening.reading?.rms ?? 0} />
              {heard !== null && <> · hearing <strong>{midiToNoteName(Math.round(heard)).label}</strong></>}
            </>
          )}
          {listening.status === 'calibrating' && 'Measuring background noise… keep quiet'}
          {listening.status === 'starting' && 'Starting the microphone…'}
          {listening.status === 'idle' && 'Microphone off. Tap “Listen” to start.'}
          {listening.status === 'error' && 'Microphone not available. See “Listening” below.'}
        </p>
        <Fretboard
          positions={note.chord ? note.chord.tones.map((t) => t.position) : note.position ? [note.position] : []}
          tuning={tuning}
          chord={note.chord ? { name: note.chord.name } : undefined}
        />
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
