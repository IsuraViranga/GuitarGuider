import { useCallback, useEffect, useReducer, useRef, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { Fretboard } from '../components/fretboard/Fretboard'
import type { DetectedEvent } from '../audio/pitchTracker'
import { judgeString, planStringCheck, type StringCheck } from '../audio/stringCheck'
import { useListening } from '../audio/useListening'
import { ListeningPanel } from '../components/listening/ListeningPanel'
import { Celebration } from '../components/decor/Celebration'
import { LevelBars } from '../components/decor/LevelBars'
import { PickBurst } from '../components/decor/PickBurst'
import { FeedbackBanner } from '../components/practice/FeedbackBanner'
import { PlayedStrip } from '../components/practice/PlayedStrip'
import { SavePractice } from '../components/practice/SavePractice'
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
  type Feedback,
} from '../practice/practiceReducer'
import { canSpeak, correctionToSpeech, noteToSpeech, speak, stopSpeaking } from '../practice/speech'
import { useStringSetup } from '../practice/stringSetup'
import {
  useErrorSoundSetting,
  useMicBoostSetting,
  usePracticeModeSetting,
  useSpeakNotesSetting,
} from '../practice/usePracticeSettings'
import { samePitchPositions } from '../music/fretboard'
import { startsLine } from '../songs/lines'
import { formatGuitarNumber } from '../music/guitarNumber'
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

/** Results that get the error sound and a spoken correction. */
function isMistake(feedback: Feedback): feedback is Extract<Feedback, { kind: 'incorrect' | 'wrong-chord' | 'wrong-string' }> {
  return feedback.kind === 'incorrect' || feedback.kind === 'wrong-chord' || feedback.kind === 'wrong-string'
}

/** At most one error sound in this period, even if several wrong notes are played quickly. */
const ERROR_SOUND_COOLDOWN_MS = 800
/** Play through with Voice on: "Wrong" is said fast, and not again within this time. */
const QUICK_WRONG_COOLDOWN_MS = 1500
const QUICK_WRONG_RATE = 1.6

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
  const [speakNotes, setSpeakNotes] = useSpeakNotesSetting()
  const [stringSetup] = useStringSetup()
  const location = useLocation()

  // String check (after the guitar setup): the current note's plan, read when a note arrives.
  const stringCheckRef = useRef<StringCheck | null>(null)
  const handleNoteEvents = useCallback((events: DetectedEvent[]) => {
    for (const event of events) {
      if (event.type === 'chordStart' || event.type === 'chordWrong') {
        dispatch({ type: 'chordEvent', event })
        continue
      }
      // A note that was held for the string check carries its string's stiffness.
      const check = stringCheckRef.current
      const string = check && event.stiffness !== undefined ? judgeString(check, event.stiffness) : undefined
      dispatch({ type: 'noteEvent', event, string })
    }
  }, [])
  const listening = useListening(handleNoteEvents)
  const { resetNotes, setTargets, setChordTargets, setStiffnessProbe, playErrorSound } = listening
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

  const tuning = getTuning(song.tuningId) ?? STANDARD_TUNING
  const note = song.notes[practice.currentIndex]
  // String check: only for a single note that another string can also play, when this guitar's
  // setup can tell those strings apart. The detector then measures the string of that note.
  const stringCheck =
    !practice.completed && note.position && !note.chord && stringSetup ? planStringCheck(note.position, stringSetup, tuning) : null
  const probeMidi = stringCheck ? note.midi : null
  useEffect(() => {
    stringCheckRef.current = stringCheck
  })
  useEffect(() => {
    setStiffnessProbe(probeMidi)
  }, [probeMidi, setStiffnessProbe])

  // Practice decisions go into a diagnostic practice recording, if one is running.
  const { logEvent } = listening
  useEffect(() => {
    const { feedback } = practice
    logEvent('practice', {
      index: practice.currentIndex,
      target: targetMidi,
      feedback: feedback.kind,
      ...(feedback.kind === 'incorrect' ? { heard: Number(feedback.detectedMidi.toFixed(2)), octaveOff: feedback.octaveOff } : {}),
      ...(feedback.kind === 'wrong-string' ? { heardPosition: formatGuitarNumber(feedback.heard) } : {}),
      ...(feedback.kind === 'correct' ? { cents: Math.round(feedback.cents) } : {}),
      completed: practice.completed,
    })
    // Log once per new decision or position change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice.feedbackId, practice.positionVersion])

  // One short sound per confirmed wrong note (or wrong string). Never a sound for correct notes.
  const lastErrorSound = useRef(-Infinity)
  useEffect(() => {
    if (!isMistake(practice.feedback) || !errorSound) return
    const now = performance.now()
    if (now - lastErrorSound.current < ERROR_SOUND_COOLDOWN_MS) return
    if (playErrorSound()) lastErrorSound.current = now
    // Only a new feedback (feedbackId) should trigger the sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice.feedbackId])

  // Spoken guidance: say each new note aloud (note-by-note mode only: in play-through the song
  // moves on faster than speech). The microphone is ignored while the phone talks.
  const { setSpeaking } = listening
  const speechAvailable = canSpeak()
  const voiceActive = speechAvailable && speakNotes && practice.mode === 'strict'
  const speechText = practice.completed ? 'Song complete. Well done!' : noteToSpeech(note)
  useEffect(() => {
    if (!voiceActive) return
    speak(speechText, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) })
  }, [voiceActive, speechText, practice.positionVersion, setSpeaking])
  useEffect(() => {
    if (voiceActive) return
    stopSpeaking()
    setSpeaking(false)
  }, [voiceActive, setSpeaking])
  useEffect(() => stopSpeaking, [])
  // After a wrong note or chord (and its short error sound). Note by note: what was wrong and what
  // to play. Play through: only a quick "Wrong" (at most every 1.5 s), so the song is not held up.
  const lastQuickWrong = useRef(-Infinity)
  useEffect(() => {
    const { feedback } = practice
    if (!speechAvailable || !speakNotes || !isMistake(feedback)) return
    const muteWhileTalking = { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) }
    if (practice.mode === 'strict') {
      const correction = correctionToSpeech(song.notes[feedback.noteIndex], feedback)
      if (correction) speak(correction, muteWhileTalking)
      return
    }
    const now = performance.now()
    if (now - lastQuickWrong.current < QUICK_WRONG_COOLDOWN_MS) return
    lastQuickWrong.current = now
    speak('Wrong', { ...muteWhileTalking, rate: QUICK_WRONG_RATE })
    // Only a new result (feedbackId) should speak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice.feedbackId])
  const text = describeNote(note)
  const upcoming = song.notes.slice(practice.currentIndex + 1, practice.currentIndex + 5)
  // Other strings where the same note sounds (the app cannot tell them apart by sound).
  const samePitch = note.position && !note.chord ? samePitchPositions(note.position, tuning) : []
  const positions = note.chord ? note.chord.tones.map((t) => t.position) : note.position ? [note.position] : []
  const heard = listening.reading?.reliable && listening.reading.midi !== null ? listening.reading.midi : null

  // The pick shower plays at the end of the song and at every 5 correct notes in a row.
  const streakMilestone = practice.feedback.kind === 'correct' && practice.streak > 0 && practice.streak % 5 === 0
  const progressPercent = practice.completed ? 100 : (practice.currentIndex / song.notes.length) * 100
  const bigLabel = note.chord ? (note.chord.name ?? 'Chord') : text.number
  const stringNumber = note.position?.stringNumber
  let upcomingText: ReactNode = ''
  if (!practice.completed) {
    upcomingText =
      upcoming.length > 0 ? (
        <>
          Then:{' '}
          <strong>
            {upcoming.map((n, i) => (
              <span key={n.index}>
                {i > 0 && ' · '}
                {startsLine(n, i === 0 ? note : upcoming[i - 1]) && (
                  <span className={styles.newLine} title="New line of the song">
                    ↵{' '}
                  </span>
                )}
                {shortLabel(n) + (i === 0 && shortLabel(n) === shortLabel(note) ? ' again' : '')}
                {n.lyric && <span className={styles.upcomingWord}> {n.lyric}</span>}
              </span>
            ))}
          </strong>
        </>
      ) : (
        'Last note of the song'
      )
  }

  return (
    <div className={`page ${styles.layout}`}>
      {(practice.completed || streakMilestone) && <Celebration key={practice.feedbackId} />}
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>{song.title}</h1>
          {practice.streak >= 3 && !practice.completed && (
            <span className={styles.streak} data-testid="streak">
              <span aria-hidden="true">🔥 </span>
              {practice.streak} in a row
            </span>
          )}
        </div>
        <div className={styles.progressRow}>
          <span className={styles.progressBar} aria-hidden="true">
            <span style={{ width: `${progressPercent}%` }} />
          </span>
          <p className={styles.progress} data-testid="progress">
            Note <strong>{practice.currentIndex + 1}</strong> of {song.notes.length}
          </p>
        </div>
      </header>

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
        <div className={styles.statusRow}>
          <p className={`${styles.micLine} ${listening.status === 'listening' ? styles.micLive : ''}`} data-testid="mic-line">
            <span aria-hidden="true">🎤 </span>
            {listening.status === 'listening' && (
              <>
                Listening
                <LevelBars rms={listening.reading?.rms ?? 0} />
                {heard !== null && (
                  <>
                    {' '}
                    · hearing <strong>{midiToNoteName(Math.round(heard)).label}</strong>
                  </>
                )}
              </>
            )}
            {listening.status === 'calibrating' && 'Measuring background noise… keep quiet'}
            {listening.status === 'starting' && 'Starting the microphone…'}
            {listening.status === 'idle' && 'Microphone off'}
            {listening.status === 'error' && 'Microphone not available. See “Listening” below.'}
          </p>
          {speechAvailable && (
            <button
              type="button"
              className={`${styles.voice} ${speakNotes ? styles.voiceOn : ''}`}
              aria-pressed={speakNotes}
              onClick={() => setSpeakNotes(!speakNotes)}
            >
              <span aria-hidden="true">{speakNotes ? '🔊' : '🔈'} </span>
              Voice
            </button>
          )}
        </div>
        {speakNotes && speechAvailable && practice.mode === 'flow' && (
          <p className={styles.voiceHint}>In Play through, the voice only says “Wrong” after a mistake.</p>
        )}

        <div className={styles.noteRow}>
          <div className={styles.spotlight}>
            {practice.feedback.kind === 'correct' && <PickBurst key={`burst-${practice.feedbackId}`} />}
            <h2 id="target-heading" className={styles.targetHeading}>
              {practice.completed ? 'Last note' : 'Play next'}
            </h2>
            <p
              key={`number-${practice.positionVersion}`}
              className={`${styles.number} ${bigLabel.length > 3 ? styles.numberLong : ''}`}
              data-testid="expected-number"
            >
              {bigLabel}
            </p>
          </div>
          <div className={styles.facts}>
            {note.chord && (
              <p className={styles.chordNumbers} data-testid="expected-chord-numbers">
                {text.number}
              </p>
            )}
            <ul className={styles.chips} aria-label="How to play it">
              {note.chord ? (
                <>
                  <li className={styles.chip}>Strum {note.chord.tones.length} strings</li>
                  {note.chord.simplifiedFrom && <li className={styles.chip}>{note.chord.simplifiedFrom} (easier shape)</li>}
                </>
              ) : (
                <>
                  {stringNumber && (
                    <li className={`${styles.chip} ${styles.chipString}`}>
                      String {stringNumber}
                      {stringNumber === 1 && ' · thinnest'}
                      {stringNumber === 6 && ' · thickest'}
                    </li>
                  )}
                  {note.position && (
                    <li className={`${styles.chip} ${styles.chipFret}`}>
                      {note.position.fret === 0 ? 'Open string' : `Fret ${note.position.fret}`}
                    </li>
                  )}
                  <li className={styles.chip}>Note {text.noteName}</li>
                </>
              )}
            </ul>
          </div>
        </div>
        {note.lyric && (
          <p className={styles.lyric} data-testid="lyric">
            <span aria-hidden="true">♪ </span>
            {note.lyric}
          </p>
        )}
        <div className={styles.board}>
          <Fretboard positions={positions} tuning={tuning} chord={note.chord ? { name: note.chord.name } : undefined} />
        </div>
        {samePitch.length > 0 && note.position && (
          <p className={styles.samePitch} data-testid="same-pitch">
            <span aria-hidden="true">👂 </span>
            {samePitch.map(formatGuitarNumber).join(' and ')} {samePitch.length === 1 ? 'sounds' : 'sound'} the same.{' '}
            {stringCheck ? (
              <>
                The string check listens for the string, so play it on <strong>string {note.position.stringNumber}</strong> as
                shown.
              </>
            ) : (
              <>
                The app hears the note, not the string, so play it on <strong>string {note.position.stringNumber}</strong> as
                shown.{' '}
                {stringSetup ? (
                  'Your guitar setup cannot check these strings (they sound too alike, or one was skipped).'
                ) : (
                  <Link to="/guitar-setup" state={{ from: location.pathname }} className={styles.setupLink}>
                    Set up the string check (30 s)
                  </Link>
                )}
              </>
            )}
          </p>
        )}

        <p className={styles.upcoming} data-testid="upcoming">
          {upcomingText}
        </p>
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
          <button type="button" className={`button ${styles.live}`} onClick={listening.stop}>
            <span aria-hidden="true">❚❚</span> Pause
          </button>
        ) : (
          <button type="button" className="button button-primary" onClick={() => listening.start({ boost })}>
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

      <div className={styles.played}>
        <PlayedStrip
          notes={song.notes}
          record={practice.record}
          currentIndex={practice.currentIndex}
          completed={practice.completed}
          onSelect={(index) => dispatch({ type: 'jumpTo', index })}
        >
          <SavePractice song={song} practice={practice} />
        </PlayedStrip>
      </div>

      <fieldset className={styles.mode}>
        <legend className={styles.modeLegend}>How should the app follow you?</legend>
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
          record={practice.record}
        />
      </section>
    </div>
  )
}
