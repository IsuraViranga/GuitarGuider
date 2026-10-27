import { useCallback, useEffect, useReducer, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import type { DetectedEvent } from '../audio/pitchTracker'
import { useListening } from '../audio/useListening'
import { MICROPHONE_ERROR_MESSAGES } from '../audio/microphone'
import { Celebration } from '../components/decor/Celebration'
import { GuitarPick } from '../components/decor/GuitarPick'
import { LevelBars } from '../components/decor/LevelBars'
import { PickBurst } from '../components/decor/PickBurst'
import { Fretboard } from '../components/fretboard/Fretboard'
import { PracticeRecorder } from '../components/listening/PracticeRecorder'
import { midiToNoteName } from '../music/pitch'
import { STANDARD_TUNING, type StringNumber } from '../music/tuning'
import { useMicBoostSetting } from '../practice/usePracticeSettings'
import {
  countedPlucks,
  INITIAL_SETUP,
  neighbourPairs,
  SETUP_ORDER,
  SETUP_PLUCKS,
  setupReducer,
  setupString,
  useStringSetup,
  type PairStatus,
  type SetupState,
} from '../practice/stringSetup'
import styles from './GuitarSetupPage.module.css'

/** A whole setup, with strings that need many tries, fits easily (≈ 58 MB at 48 kHz). */
const SETUP_RECORDING_SECONDS = 300

const STRING_HINTS: Partial<Record<StringNumber, string>> = { 1: 'the thinnest', 6: 'the thickest' }

const LAST_MESSAGES: Record<NonNullable<SetupState['last']>, string> = {
  counted: 'Got it. Pluck it again the same way.',
  unclear: 'That one was not clear. Quiet the other strings with your hand, then pluck again.',
  'not-same': 'Those sounded a little different. Keep plucking the same way.',
  kept: 'Done. Now the next string.',
  'left-out': 'That string did not sound clear enough to measure. The app will not check it. Now the next string.',
}

const PAIR_TEXT: Record<PairStatus, string> = {
  checked: 'the app can tell which one you play',
  'too-alike': 'they sound too alike on your guitar, so these are not checked',
  'not-measured': 'not checked (a string was skipped)',
}

const openLabel = (string: StringNumber) => midiToNoteName(STANDARD_TUNING.openStringMidi[string]).label

/**
 * Guitar setup for the string check: the student plucks each open string 3 times, and the app
 * learns how stiff each string is (see audio/stringCheck.ts). Saved in this browser.
 */
export function GuitarSetupPage() {
  usePageTitle('Guitar setup')
  const location = useLocation()
  const backTo = (location.state as { from?: string } | null)?.from
  const [saved, save] = useStringSetup()
  const [boost] = useMicBoostSetting()
  const [setup, dispatch] = useReducer(setupReducer, INITIAL_SETUP)
  /** A note that was not the open string asked for (MIDI), to say what was heard. */
  const [otherNote, setOtherNote] = useState<number | null>(null)
  const [pluckId, setPluckId] = useState(0)
  /** Once the microphone was started, the test recorder stays (a recording must outlive the last string). */
  const [micUsed, setMicUsed] = useState(false)

  const handleEvents = useCallback((events: DetectedEvent[]) => {
    for (const event of events) {
      if (event.type !== 'noteStart') continue
      // Only the open string asked for is measured (it carries a stiffness); anything else was another note.
      if (event.stiffness === undefined) {
        setOtherNote(event.midi)
        continue
      }
      setOtherNote(null)
      setPluckId((id) => id + 1)
      dispatch({ type: 'pluck', stiffness: event.stiffness })
    }
  }, [])
  const listening = useListening(handleEvents)
  const { resetNotes, setTargets, setStiffnessProbe, stop } = listening
  const active = listening.status === 'listening' || listening.status === 'calibrating' || listening.status === 'starting'

  const string = setupString(setup)
  const done = string === null
  const openMidi = string === null ? null : STANDARD_TUNING.openStringMidi[string]
  useEffect(() => {
    resetNotes({ requireFreshOnset: true })
    setTargets(openMidi === null ? [] : [openMidi])
    setStiffnessProbe(openMidi)
    setOtherNote(null)
  }, [openMidi, resetNotes, setTargets, setStiffnessProbe])

  // Finished: save what was measured and stop listening.
  useEffect(() => {
    if (!done) return
    stop()
    if (Object.keys(setup.open).length > 0) save({ open: setup.open, misfit: setup.misfit, savedAt: new Date().toISOString() })
    // Save once when the setup finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  const pairs = neighbourPairs(done ? setup.open : (saved?.open ?? {}), STANDARD_TUNING)
  const restart = () => {
    dispatch({ type: 'restart' })
    setOtherNote(null)
  }

  return (
    <div className={`page ${styles.layout}`}>
      {done && Object.keys(setup.open).length > 0 && <Celebration />}
      <header className={styles.header}>
        <h1 className={styles.title}>Guitar setup</h1>
        <p className={styles.lead}>
          Some notes sound the same on two strings: <code>10</code> and <code>25</code> are both E4. Each string still rings a
          little differently. Pluck each open string 3 times and the app learns your strings, so it can tell when a note is played
          on the wrong string. It takes about 30 seconds.
        </p>
      </header>

      {saved && !active && !done && setup.index === 0 && (
        <section className={`card ${styles.saved}`} aria-label="Saved setup">
          <p>
            <span aria-hidden="true">✓ </span>
            Your guitar was set up on <strong>{new Date(saved.savedAt).toLocaleDateString()}</strong>. Do it again after
            changing strings or on another guitar.
          </p>
          <button type="button" className="button" onClick={() => save(null)}>
            Remove the setup
          </button>
        </section>
      )}

      {!done && (
        <section className={`card ${styles.step}`} aria-labelledby="setup-step">
          <p className={styles.tip}>
            <span aria-hidden="true">🎸 </span>Tune your guitar first. Play in a quiet room, and pluck firmly, like when you practise.
          </p>
          {active ? (
            <>
              <h2 id="setup-step" className={styles.stepTitle}>
                Pluck <span className={styles.stringName}>string {string}</span> open
                <span className={styles.stepNote}>
                  {' '}
                  ({openLabel(string!)}
                  {STRING_HINTS[string!] ? `, ${STRING_HINTS[string!]}` : ''})
                </span>
              </h2>
              <div className={styles.picks} role="img" aria-label={`${countedPlucks(setup)} of ${SETUP_PLUCKS} plucks`} data-testid="setup-picks">
                {setup.last === 'counted' && <PickBurst key={pluckId} />}
                {Array.from({ length: SETUP_PLUCKS }, (_, i) => (
                  <GuitarPick key={i} className={styles.pick} filled={i < countedPlucks(setup)} />
                ))}
              </div>
              <p role="status" className={styles.message} data-testid="setup-message">
                {listening.status === 'calibrating' && 'Measuring background noise… keep quiet.'}
                {listening.status === 'starting' && 'Starting the microphone…'}
                {listening.status === 'listening' &&
                  (otherNote !== null
                    ? `That was ${midiToNoteName(Math.round(otherNote)).label}. Pluck string ${string} open (${openLabel(string!)}). Is it tuned?`
                    : setup.last
                      ? LAST_MESSAGES[setup.last]
                      : `Pluck it ${SETUP_PLUCKS} times, letting it ring a moment each time.`)}
              </p>
              {listening.status === 'listening' && (
                <p className={styles.level} aria-hidden="true">
                  🎤 <LevelBars rms={listening.reading?.rms ?? 0} />
                </p>
              )}
              <div className={styles.board}>
                <Fretboard positions={[{ stringNumber: string!, fret: 0 }]} tuning={STANDARD_TUNING} />
              </div>
              <div className={styles.buttons}>
                <button type="button" className="button" onClick={() => dispatch({ type: 'skip' })}>
                  Skip this string
                </button>
                <button type="button" className="button" onClick={stop}>
                  <span aria-hidden="true">❚❚</span> Pause
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 id="setup-step" className={styles.stepTitle}>
                {setup.index === 0 ? 'Ready?' : `Next: string ${string}`}
              </h2>
              {listening.status === 'error' && listening.error && (
                <p className={styles.error} role="alert">
                  {MICROPHONE_ERROR_MESSAGES[listening.error]}
                </p>
              )}
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setMicUsed(true)
                  listening.start({ boost })
                }}
              >
                <span aria-hidden="true">🎤</span> {setup.index === 0 ? 'Start' : 'Continue'}
              </button>
            </>
          )}
        </section>
      )}

      <ol className={styles.strings} aria-label="Strings">
        {SETUP_ORDER.map((s, i) => {
          const status = setup.open[s] !== undefined ? 'kept' : setup.left.includes(s) ? 'left' : i === setup.index ? 'now' : 'waiting'
          return (
            <li key={s} className={`${styles.stringRow} ${styles[status]}`} data-status={status}>
              <span className={styles.stringNumber}>{s}</span>
              <span>
                String {s} · {openLabel(s)}
              </span>
              <span className={styles.stringStatus}>
                {status === 'kept' && '✓ learned'}
                {status === 'left' && 'not checked'}
                {status === 'now' && (active ? 'listening…' : 'next')}
              </span>
            </li>
          )
        })}
      </ol>

      {micUsed && (
        // For testing: the sound and every measurement, to check the setup on a real guitar.
        <section className={`card ${styles.recorder}`} aria-label="Setup recording">
          <PracticeRecorder
            listening={listening}
            title="Setup recording (for testing)"
            playHint="Pluck each string as the app asks."
            startLabel="Record this setup"
            maxSeconds={SETUP_RECORDING_SECONDS}
          />
        </section>
      )}

      {done && (
        <section className={`card ${styles.result}`} aria-labelledby="setup-done" data-testid="setup-result">
          <h2 id="setup-done" className={styles.stepTitle}>
            {Object.keys(setup.open).length > 0 ? 'Your guitar is set up!' : 'Nothing was measured'}
          </h2>
          {Object.keys(setup.open).length > 0 ? (
            <>
              <p>The string check is now on. When the same note can be played on two strings:</p>
              <ul className={styles.pairs}>
                {pairs.map(({ strings: [a, b], status }) => (
                  <li key={a} data-status={status}>
                    <span aria-hidden="true">{status === 'checked' ? '✓' : '–'} </span>
                    <strong>
                      Strings {a} and {b}:
                    </strong>{' '}
                    {PAIR_TEXT[status]}.
                  </li>
                ))}
              </ul>
              <p className={styles.note}>When the app is not sure, it counts the note as right, as before.</p>
            </>
          ) : (
            <p>All strings were skipped, so the string check stays off.</p>
          )}
          <div className={styles.buttons}>
            <Link className="button button-primary" to={backTo ?? '/songs'}>
              {backTo ? 'Back to the song' : 'Go to the songs'}
            </Link>
            <button type="button" className="button" onClick={restart}>
              Do it again
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
