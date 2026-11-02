import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MICROPHONE_ERROR_MESSAGES } from '../audio/microphone'
import type { DetectedEvent } from '../audio/pitchTracker'
import { useListening } from '../audio/useListening'
import { LevelBars } from '../components/decor/LevelBars'
import { positionsForMidi } from '../music/fretboard'
import { describePosition, formatGuitarNumber, samePosition, type GuitarPosition } from '../music/guitarNumber'
import { midiToNoteName } from '../music/pitch'
import { STANDARD_TUNING, type StringNumber } from '../music/tuning'
import { useMicBoostSetting } from '../practice/usePracticeSettings'
import { getFingerprints, type DatasetGuitar } from './datasetApi'
import { countPairs, createSoundMatch, fingerprint, MAX_MATCHED_FRET, type Identified, type SoundMatch } from './soundMatch'
import styles from './Dataset.module.css'

/** Every note on strings 1–6 up to MAX_MATCHED_FRET (all recorded places), low to high, with its places. */
const TEST_NOTES = Array.from({ length: 48 }, (_, i) => 40 + i)
  .map((midi) => ({ midi, places: positionsForMidi(midi, STANDARD_TUNING).filter((p) => p.fret <= MAX_MATCHED_FRET) }))
  .filter((note) => note.places.length > 0)

/** Not heard right: the places the player may have played at (all of them when the note has one place). */
function fixPlaces(places: GuitarPosition[], identified: Identified): GuitarPosition[] {
  const others = places.filter((p) => identified.result !== 'heard' || !samePosition(p, identified.position))
  return others.length > 0 ? others : places
}

const placeList = (places: readonly GuitarPosition[]) => places.map(formatGuitarNumber).join(' · ')

type Result =
  /** answer: the player's mark (heard at one place); actual: where they say they played (not heard right). */
  | { kind: 'identified'; identified: Identified; answer: 'right' | 'wrong' | null; actual: GuitarPosition | null }
  /** Another note was played. */
  | { kind: 'other'; midi: number }
  /** The pluck was heard but could not be measured. */
  | { kind: 'unmeasured' }

/** Not heard right: where the player played, then (their own guitar) add a recording or check its recordings. */
function FixPanel({
  guitar,
  places,
  actual,
  canEdit,
  onPlayedAt,
  onAddRecording,
  onCheckRecordings,
}: {
  guitar: DatasetGuitar
  places: GuitarPosition[]
  actual: GuitarPosition | null
  canEdit: boolean
  onPlayedAt: (position: GuitarPosition) => void
  onAddRecording: (guitarId: string, position: GuitarPosition) => void
  onCheckRecordings: (guitarId: string, position: GuitarPosition) => void
}) {
  return (
    <div className={styles.testFix} data-testid="test-fix">
      {actual === null ? (
        <>
          <p>Where did you play it?</p>
          <div className={styles.testPlaces}>
            {places.map((p) => (
              <button key={formatGuitarNumber(p)} type="button" className="button" onClick={() => onPlayedAt(p)}>
                {formatGuitarNumber(p)}
              </button>
            ))}
          </div>
        </>
      ) : canEdit ? (
        <>
          <p>
            Help it hear {formatGuitarNumber(actual)} on {guitar.name}:
          </p>
          <div className={styles.testPlaces}>
            <button type="button" className="button button-primary" onClick={() => onAddRecording(guitar.id, actual)}>
              🎙 Add a recording of {formatGuitarNumber(actual)}
            </button>
            <button type="button" className="button" onClick={() => onCheckRecordings(guitar.id, actual)}>
              📋 Check its recordings
            </button>
          </div>
          <p className="muted">Pluck it the way you usually play. A recording that sounds wrong can be deleted.</p>
        </>
      ) : (
        <p className="muted">Thanks! Only the owner of {guitar.name} can change its recordings. Record your own guitar for the best check.</p>
      )}
    </div>
  )
}

/** The guitar shown first: the player's own (most recorded), else the default guitar, else the first. */
function firstGuitar(guitars: DatasetGuitar[], preferred: string | null): string {
  const own = guitars.filter((g) => g.mine).sort((a, b) => b.fingerprints - a.fingerprints)[0]
  return (guitars.find((g) => g.id === preferred) ?? own ?? guitars.find((g) => g.isDefault) ?? guitars[0])?.id ?? ''
}

/**
 * Test my guitar: choose a recorded guitar and a note, play the note on any of its strings, and see
 * which place the guitar's recordings say it was played at (or "can't tell"). The player marks each
 * answer right or wrong for a score. When it was not heard right, the player says where they played
 * and, on their own guitar (the admin: any), adds a recording of that place or checks its
 * recordings. The test itself saves nothing, and practice is not changed.
 */
export function TestPanel({
  guitars,
  preferredGuitarId,
  admin,
  onAddRecording,
  onCheckRecordings,
}: {
  guitars: DatasetGuitar[]
  preferredGuitarId: string | null
  admin: boolean
  onAddRecording: (guitarId: string, position: GuitarPosition) => void
  onCheckRecordings: (guitarId: string, position: GuitarPosition) => void
}) {
  const [guitarId, setGuitarId] = useState(() => firstGuitar(guitars, preferredGuitarId))
  const [midi, setMidi] = useState(TEST_NOTES.find((n) => n.midi === 64)?.midi ?? TEST_NOTES[0].midi)
  const [matches, setMatches] = useState<Record<string, SoundMatch | null | 'error'>>({})
  const [result, setResult] = useState<Result | null>(null)
  const [pluckId, setPluckId] = useState(0)
  const [score, setScore] = useState({ right: 0, wrong: 0, unsure: 0 })
  const [boost] = useMicBoostSetting()

  const guitar = guitars.find((g) => g.id === guitarId) ?? null
  const note = TEST_NOTES.find((n) => n.midi === midi) ?? TEST_NOTES[0]
  const match = guitar ? matches[guitar.id] : undefined

  useEffect(() => {
    if (!guitarId || matches[guitarId] !== undefined) return
    let current = true
    getFingerprints(guitarId)
      .then((found) => {
        const references = found.fingerprints.map((r) => ({ stringNumber: r.stringNumber as StringNumber, fret: r.fret, v: r.v }))
        if (current) setMatches((all) => ({ ...all, [guitarId]: createSoundMatch(references) }))
      })
      .catch(() => current && setMatches((all) => ({ ...all, [guitarId]: 'error' })))
    return () => {
      current = false
    }
  }, [guitarId, matches])

  // The pluck handler reads the current guitar and note through a ref (the listener is created once).
  const now = useRef({ match: null as SoundMatch | null, places: note.places })
  useEffect(() => {
    now.current = { match: match && match !== 'error' ? match : null, places: note.places }
  }, [match, note])

  const handleEvents = useCallback((events: DetectedEvent[]) => {
    for (const event of events) {
      if (event.type !== 'noteStart') continue
      const { match: current, places } = now.current
      if (!current) continue
      let next: Result
      // Only the note asked for is measured (it carries a stiffness); anything else was another note.
      if (event.stiffness === undefined) next = { kind: 'other', midi: event.midi }
      else {
        const pluck = fingerprint(event.stiffness)
        next = pluck ? { kind: 'identified', identified: current.identify(places, pluck), answer: null, actual: null } : { kind: 'unmeasured' }
      }
      if (next.kind === 'identified' && next.identified.result === 'unsure') setScore((s) => ({ ...s, unsure: s.unsure + 1 }))
      setResult(next)
      setPluckId((id) => id + 1)
    }
  }, [])
  const listening = useListening(handleEvents)
  const { resetNotes, setTargets, setStiffnessProbe } = listening
  const micOn = listening.status === 'listening'
  const starting = listening.status === 'starting' || listening.status === 'calibrating'

  useEffect(() => {
    resetNotes({ requireFreshOnset: true })
    setTargets([midi])
    setStiffnessProbe(midi)
  }, [midi, guitarId, resetNotes, setTargets, setStiffnessProbe])

  const answer = (right: boolean) => {
    setResult((r) => (r?.kind === 'identified' ? { ...r, answer: right ? 'right' : 'wrong' } : r))
    setScore((s) => (right ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 }))
  }
  const playedAt = (position: GuitarPosition) => setResult((r) => (r?.kind === 'identified' ? { ...r, actual: position } : r))
  const canEdit = guitar !== null && (guitar.mine || admin)

  const pairs = useMemo(() => (match && match !== 'error' ? countPairs(match) : null), [match])
  const missing = match && match !== 'error' ? note.places.filter((p) => !match.hasRecordings(p)) : []
  const noteName = midiToNoteName(note.midi).label

  if (guitars.length === 0) {
    return (
      <section className={`card ${styles.test}`} aria-label="Test my guitar">
        <p>No recorded guitar yet. Record your guitar on the Record tab, then test it here.</p>
      </section>
    )
  }

  return (
    <>
      <section className={`card ${styles.test}`} aria-label="Guitar and note">
        <label className={styles.testField}>
          <span>Guitar</span>
          <select className={styles.select} value={guitarId} onChange={(e) => {
              setGuitarId(e.target.value)
              setResult(null)
            }}>
            {guitars.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.mine ? 'yours' : `by ${g.ownerName ?? 'a player'}`}
              </option>
            ))}
          </select>
        </label>
        {match === undefined && <p className="muted">Loading the recordings…</p>}
        {match === 'error' && (
          <p role="alert" className={styles.error}>
            Could not load this guitar's recordings. Please check your connection and try again.
          </p>
        )}
        {pairs && (
          <p className={`muted ${styles.testSummary}`} data-testid="test-pairs">
            Its recordings tell <strong>{pairs.on} of {pairs.total}</strong> same-sounding pairs apart.
          </p>
        )}

        <fieldset className={styles.choice}>
          <legend>Note to play</legend>
          <div className={styles.testNotes}>
            {TEST_NOTES.map((n) => (
              <button
                key={n.midi}
                type="button"
                className={`${styles.testNote} ${n.midi === midi ? styles.testNoteOn : ''}`}
                aria-pressed={n.midi === midi}
                onClick={() => {
                  setMidi(n.midi)
                  setResult(null)
                }}
              >
                <strong>{midiToNoteName(n.midi).label}</strong>
                <span>{placeList(n.places)}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className={`card ${styles.recorder}`} aria-label="Play and check">
        <p className={styles.testCue}>
          Play <strong>{noteName}</strong> {note.places.length === 1 ? 'at' : 'on any of these:'} <strong>{placeList(note.places)}</strong>
        </p>
        {missing.length > 0 && (
          <p className="muted">
            Not recorded on this guitar: {placeList(missing)}. Playing {missing.length === 1 ? 'it' : 'them'} cannot be told apart.
          </p>
        )}

        {!micOn && !starting && (
          <>
            {listening.status === 'error' && listening.error && (
              <p className={styles.error} role="alert">
                {MICROPHONE_ERROR_MESSAGES[listening.error]}
              </p>
            )}
            <button type="button" className={`button button-primary ${styles.big}`} onClick={() => listening.start({ boost })} disabled={!match || match === 'error'}>
              🎤 Start listening
            </button>
          </>
        )}
        {starting && (
          <p role="status" className={styles.cue}>
            {listening.status === 'starting' ? 'Starting the microphone…' : 'Measuring background noise… keep quiet.'}
          </p>
        )}

        {micOn && (
          <>
            <div key={pluckId} className={styles.testResult} role="status" data-testid="test-result">
              {result === null && <p className="muted">Listening… play {noteName}.</p>}
              {result?.kind === 'other' && (
                <p>
                  That was <strong>{midiToNoteName(result.midi).label}</strong>. Play {noteName}.
                </p>
              )}
              {result?.kind === 'unmeasured' && <p>Heard it, but could not measure it. Play it again and let it ring.</p>}
              {result?.kind === 'identified' && result.identified.result === 'heard' && (
                <>
                  <p className={styles.testHeardLabel}>Heard at</p>
                  <p className={styles.testHeard}>{formatGuitarNumber(result.identified.position)}</p>
                  <p className="muted">{describePosition(result.identified.position)}</p>
                  {result.answer === 'right' && <p className={styles.good}>✓ Great! Play again.</p>}
                  {result.answer === null && (
                    <div className={styles.testAnswer}>
                      <span>Is that where you played?</span>
                      <button type="button" className={`button ${styles.testRight}`} onClick={() => answer(true)}>
                        ✓ Yes
                      </button>
                      <button type="button" className={`button ${styles.testWrong}`} onClick={() => answer(false)}>
                        ✗ No
                      </button>
                    </div>
                  )}
                </>
              )}
              {result?.kind === 'identified' && result.identified.result === 'unsure' && (
                <p>
                  🤔 Can't tell: <strong>{placeList(result.identified.positions)}</strong> sound alike on this guitar.
                </p>
              )}
              {guitar && result?.kind === 'identified' && (result.answer === 'wrong' || result.identified.result === 'unsure') && (
                <FixPanel
                  guitar={guitar}
                  places={fixPlaces(note.places, result.identified)}
                  actual={result.actual}
                  canEdit={canEdit}
                  onPlayedAt={playedAt}
                  onAddRecording={onAddRecording}
                  onCheckRecordings={onCheckRecordings}
                />
              )}
              {result?.kind === 'identified' && result.identified.result === 'notRecorded' && <p>This guitar has no recordings of {noteName}.</p>}
            </div>
            <p className={styles.level} aria-hidden="true">
              🎤 <LevelBars rms={listening.reading?.rms ?? 0} />
            </p>
            <button type="button" className="button" onClick={listening.stop}>
              ■ Stop listening
            </button>
          </>
        )}

        <div className={styles.testScore} aria-label="Score" data-testid="test-score">
          <span className={styles.testScoreRight}>✓ Right {score.right}</span>
          <span className={styles.testScoreWrong}>✗ Wrong {score.wrong}</span>
          <span>🤔 Can't tell {score.unsure}</span>
          {score.right + score.wrong + score.unsure > 0 && (
            <button type="button" className={styles.linkButton} onClick={() => setScore({ right: 0, wrong: 0, unsure: 0 })}>
              Reset
            </button>
          )}
        </div>
      </section>
    </>
  )
}
