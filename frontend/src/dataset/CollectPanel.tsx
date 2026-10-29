import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { MICROPHONE_ERROR_MESSAGES } from '../audio/microphone'
import type { DetectedEvent } from '../audio/pitchTracker'
import { useListening } from '../audio/useListening'
import { encodeWav } from '../audio/wav'
import { LevelBars } from '../components/decor/LevelBars'
import { Fretboard } from '../components/fretboard/Fretboard'
import { DEFAULT_MAX_FRET, STANDARD_TUNING, type StringNumber } from '../music/tuning'
import { guitarProgress, saveSample, type DatasetGuitar, type Device, type Noise, type PluckMethod, type PluckStrength } from './datasetApi'
import { ChoiceChips, GuitarForm } from './DatasetControls'
import {
  AFTER_PLUCK_MS,
  checkPluck,
  countKey,
  countsOf,
  expectedNote,
  loadSession,
  MAIN_FRETS,
  MAX_TAKE_SECONDS,
  nextIncomplete,
  PLUCK_TARGETS,
  positionCode,
  READY_MS,
  saveSession,
  woundLabel,
  type PluckCheck,
  type Position,
  type Session,
} from './pluck'
import styles from './Dataset.module.css'

const NOISE: { value: Noise; label: string }[] = [
  { value: 'quiet', label: 'Quiet' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'noisy', label: 'Noisy' },
]
const METHODS: { value: PluckMethod; label: string }[] = [
  { value: 'finger', label: 'Finger' },
  { value: 'pick', label: 'Pick' },
]
const STRENGTHS: { value: PluckStrength; label: string }[] = [
  { value: 'soft', label: 'Soft' },
  { value: 'medium', label: 'Medium' },
  { value: 'strong', label: 'Strong' },
]
const DEVICES: { value: Device; label: string }[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'laptop', label: 'Laptop' },
  { value: 'other', label: 'Other' },
]
const STRINGS: StringNumber[] = [1, 2, 3, 4, 5, 6]

type Take =
  | { step: 'idle' }
  | { step: 'recording'; position: Position; cue: 'ready' | 'pluck'; heard: boolean }
  | { step: 'review'; position: Position; wav: Blob; url: string; sampleRate: number; check: PluckCheck; saving: boolean; error: string | null }

/** The browser's sound processing the app asks to turn off (audio/microphone.ts), as requested. */
const CAPTURE_REQUESTED = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('input, textarea, select, button, audio, summary') !== null

/**
 * Recording plucks for the dataset: choose the position, record one pluck, listen, then save,
 * retake or discard. The guitar and conditions stay the same between recordings; after the
 * chosen number of plucks at a position, the next unfinished position is chosen.
 */
export function CollectPanel({ guitars, onGuitarAdded }: { guitars: DatasetGuitar[]; onGuitarAdded: (guitar: DatasetGuitar) => void }) {
  const [session, setSession] = useState<Session>(loadSession)
  const guitar = guitars.find((g) => g.id === session.guitarId) ?? null
  const [editing, setEditing] = useState(guitar === null)
  const [addingGuitar, setAddingGuitar] = useState(guitars.length === 0)
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [progressError, setProgressError] = useState(false)
  const [allFrets, setAllFrets] = useState(session.position.fret > MAIN_FRETS)
  const [take, setTake] = useState<Take>({ step: 'idle' })
  const [saved, setSaved] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const update = (change: Partial<Session>) => setSession((current) => ({ ...current, ...change }))
  useEffect(() => saveSession(session), [session])

  // Samples already kept per position on this guitar.
  useEffect(() => {
    if (!session.guitarId) return
    let current = true
    guitarProgress(session.guitarId)
      .then((progress) => {
        if (!current) return
        setCounts(countsOf(progress))
        setProgressError(false)
      })
      .catch(() => current && setProgressError(true))
    return () => {
      current = false
    }
  }, [session.guitarId])

  // ---------- recording ----------
  const takeRef = useRef(take)
  useEffect(() => {
    takeRef.current = take
  }, [take])
  const timers = useRef<number[]>([])
  const clearTimers = () => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
  }
  const finishRef = useRef<() => void>(() => {})

  const handleEvents = useCallback((events: DetectedEvent[]) => {
    const current = takeRef.current
    if (current.step !== 'recording' || current.heard || !events.some((e) => e.type === 'noteStart')) return
    setTake({ ...current, heard: true, cue: 'pluck' })
    timers.current.push(window.setTimeout(() => finishRef.current(), AFTER_PLUCK_MS))
  }, [])
  const listening = useListening(handleEvents)
  const { resetNotes, setTargets, startRecording, stopRecording } = listening
  const micOn = listening.status === 'listening'
  const expected = expectedNote(session.position)

  // The detector listens for the expected note (so it notices the pluck).
  useEffect(() => {
    resetNotes({ requireFreshOnset: true })
    setTargets([expected.midi])
  }, [expected.midi, resetNotes, setTargets])

  function record() {
    if (!micOn || takeRef.current.step === 'recording' || !guitar || !startRecording(MAX_TAKE_SECONDS)) return
    setSaved(null)
    resetNotes({ requireFreshOnset: true })
    setTake({ step: 'recording', position: session.position, cue: 'ready', heard: false })
    timers.current.push(
      window.setTimeout(() => setTake((t) => (t.step === 'recording' ? { ...t, cue: 'pluck' } : t)), READY_MS),
      window.setTimeout(() => finishRef.current(), MAX_TAKE_SECONDS * 1000),
    )
  }

  function finish() {
    const current = takeRef.current
    if (current.step !== 'recording') return
    clearTimers()
    const recording = stopRecording()
    if (!recording) {
      setTake({ step: 'idle' })
      return
    }
    const wav = new Blob([encodeWav(recording.samples, recording.sampleRate)], { type: 'audio/wav' })
    setTake({
      step: 'review',
      position: current.position,
      wav,
      url: URL.createObjectURL(wav),
      sampleRate: recording.sampleRate,
      check: checkPluck(recording, expectedNote(current.position).midi),
      saving: false,
      error: null,
    })
  }
  useEffect(() => {
    finishRef.current = finish
  })

  // The review's sound is released when it is saved, retaken, discarded or the page closes.
  const reviewUrl = take.step === 'review' ? take.url : null
  useEffect(() => () => void (reviewUrl && URL.revokeObjectURL(reviewUrl)), [reviewUrl])
  useEffect(() => () => clearTimers(), [])

  const discard = () => {
    setTake({ step: 'idle' })
    setNote('')
  }
  const retake = () => {
    discard()
    // After the state is idle again.
    window.setTimeout(record, 0)
  }

  async function save() {
    const current = takeRef.current
    if (current.step !== 'review' || current.saving || !guitar) return
    setTake({ ...current, saving: true, error: null })
    try {
      const { countAtPosition } = await saveSample(current.wav, {
        guitarId: guitar.id,
        stringNumber: current.position.stringNumber,
        fret: current.position.fret,
        backgroundNoise: session.backgroundNoise,
        pluckMethod: session.pluckMethod,
        pluckStrength: session.pluckStrength,
        device: session.device,
        notes: note.trim() || null,
        pluckAtMs: current.check.pluckAtMs,
        capture: { sampleRate: current.sampleRate, ...CAPTURE_REQUESTED },
      })
      const code = positionCode(current.position)
      const nextCounts = new Map(counts).set(countKey(current.position.stringNumber, current.position.fret), countAtPosition)
      setCounts(nextCounts)
      let message = `Saved ✓ ${countAtPosition} of ${session.target} at ${code}.`
      if (countAtPosition >= session.target) {
        const next = nextIncomplete(nextCounts, current.position, session.target)
        if (next) {
          update({ position: next })
          message += ` ${code} is done. Next: ${positionCode(next)}.`
        } else message += ' Every position up to fret 7 is done on this guitar!'
      }
      setSaved(message)
      setNote('')
      setTake({ step: 'idle' })
    } catch (problem) {
      const latest = takeRef.current
      if (latest.step === 'review') setTake({ ...latest, saving: false, error: problem instanceof ApiError ? problem.message : 'Could not save. Please try again.' })
    }
  }

  // Keyboard: Space records / stops, Enter saves, R retakes, Esc discards.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTyping(event.target) || event.repeat) return
      const current = takeRef.current
      if (event.key === ' ' && current.step === 'idle') record()
      else if (event.key === ' ' && current.step === 'recording') finishRef.current()
      else if (event.key === 'Enter' && current.step === 'review') void save()
      else if (event.key.toLowerCase() === 'r' && current.step === 'review' && !current.saving) retake()
      else if (event.key === 'Escape' && current.step === 'review' && !current.saving) discard()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const busy = take.step !== 'idle'
  const frets = Array.from({ length: (allFrets ? DEFAULT_MAX_FRET : MAIN_FRETS) + 1 }, (_, i) => i)
  const choose = (position: Position) => {
    setSaved(null)
    update({ position })
  }

  return (
    <div className={styles.collect}>
      {/* The guitar and conditions: set once, kept for every recording. */}
      <section className={`card ${styles.settings}`} aria-label="Guitar and conditions">
        {!editing && guitar ? (
          <div className={styles.summary}>
            <p>
              <strong>🎸 {guitar.name}</strong>{' '}
              <span className="muted">
                · {guitar.guitarType}, {guitar.stringMaterial}
              </span>
              <br />
              <span className="muted">
                {session.backgroundNoise} · {session.pluckMethod} · {session.pluckStrength}
                {session.device ? ` · ${session.device}` : ''} · {session.target} per position
              </span>
            </p>
            <button type="button" className="button" onClick={() => setEditing(true)} disabled={busy}>
              Change
            </button>
          </div>
        ) : (
          <div className={styles.settingsForm}>
            {addingGuitar ? (
              <GuitarForm
                onAdded={(added) => {
                  onGuitarAdded(added)
                  update({ guitarId: added.id })
                  setAddingGuitar(false)
                }}
                onCancel={guitars.length > 0 ? () => setAddingGuitar(false) : undefined}
              />
            ) : (
              <div className="field">
                <label htmlFor="dataset-guitar">Guitar</label>
                <div className={styles.guitarPick}>
                  <select id="dataset-guitar" className={styles.select} value={guitar?.id ?? ''} onChange={(e) => update({ guitarId: e.target.value || null })}>
                    <option value="">Choose a guitar…</option>
                    {guitars.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.samples})
                      </option>
                    ))}
                  </select>
                  <button type="button" className="button" onClick={() => setAddingGuitar(true)}>
                    + Add guitar
                  </button>
                </div>
              </div>
            )}
            {/* The conditions come after the guitar is saved, so the form has one button at a time. */}
            {!addingGuitar && (
              <>
                <ChoiceChips legend="Background noise" options={NOISE} value={session.backgroundNoise} onChange={(v) => update({ backgroundNoise: v })} />
                <ChoiceChips legend="Plucking" options={METHODS} value={session.pluckMethod} onChange={(v) => update({ pluckMethod: v })} />
                <ChoiceChips legend="Strength" options={STRENGTHS} value={session.pluckStrength} onChange={(v) => update({ pluckStrength: v })} />
                <ChoiceChips legend="Device" options={DEVICES} value={session.device ?? 'other'} onChange={(v) => update({ device: v })} />
                <ChoiceChips
                  legend="Plucks per position"
                  options={PLUCK_TARGETS.map((n) => ({ value: n, label: String(n) }))}
                  value={session.target}
                  onChange={(v) => update({ target: v })}
                />
                <button type="button" className="button button-primary" disabled={!guitar} onClick={() => setEditing(false)}>
                  Done
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {guitar && (
        <>
          {/* Where to pluck: the chosen position, and how many are saved at each. */}
          <section className={`card ${styles.position}`} aria-label="Position">
            <div className={styles.positionHead}>
              <span className={styles.code} data-testid="dataset-position">
                {positionCode(session.position)}
              </span>
              <span>
                String {session.position.stringNumber} · fret {session.position.fret}
                <br />
                <strong>{expected.label}</strong> · {expected.hz.toFixed(2)} Hz · {woundLabel(guitar.woundStrings, session.position.stringNumber)}
              </span>
            </div>
            <div className={styles.board}>
              <Fretboard positions={[session.position]} tuning={STANDARD_TUNING} />
            </div>
            <div className="table-scroll">
              <table className={styles.grid}>
                <caption className="visually-hidden">Samples saved per string and fret</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="visually-hidden">String</span>
                    </th>
                    {frets.map((f) => (
                      <th key={f} scope="col">
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STRINGS.map((s) => (
                    <tr key={s}>
                      <th scope="row">{s}</th>
                      {frets.map((f) => {
                        const count = counts.get(countKey(s, f)) ?? 0
                        const done = count >= session.target
                        const selected = session.position.stringNumber === s && session.position.fret === f
                        return (
                          <td key={f}>
                            <button
                              type="button"
                              className={`${styles.cell} ${done ? styles.done : count > 0 ? styles.started : ''} ${selected ? styles.selected : ''}`}
                              aria-pressed={selected}
                              aria-label={`${s}${f}: string ${s}, fret ${f}, ${count} of ${session.target} saved`}
                              disabled={busy}
                              onClick={() => choose({ stringNumber: s, fret: f })}
                            >
                              {done ? '✓' : count}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.gridFoot}>
              {progressError && <span role="alert">Could not load the saved counts.</span>}
              <button type="button" className={styles.linkButton} onClick={() => setAllFrets(!allFrets)}>
                {allFrets ? `Show frets 0–${MAIN_FRETS} only` : `Show all frets (to ${DEFAULT_MAX_FRET})`}
              </button>
            </div>
          </section>

          {/* Record, listen, then save / retake / discard. */}
          <section className={`card ${styles.recorder}`} aria-label="Recorder">
            {!micOn && listening.status !== 'calibrating' && listening.status !== 'starting' && (
              <>
                {listening.status === 'error' && listening.error && (
                  <p role="alert" className={styles.error}>
                    {MICROPHONE_ERROR_MESSAGES[listening.error]}
                  </p>
                )}
                <button type="button" className={`button button-primary ${styles.big}`} onClick={() => listening.start({ boost: false })}>
                  🎤 Turn on the microphone
                </button>
                <p className="muted">Phone near the guitar, quiet room.</p>
              </>
            )}
            {(listening.status === 'calibrating' || listening.status === 'starting') && (
              <p role="status" className={styles.cue}>
                {listening.status === 'starting' ? 'Starting the microphone…' : 'Measuring background noise… keep quiet.'}
              </p>
            )}

            {micOn && take.step === 'idle' && (
              <>
                {saved && (
                  <p role="status" className={styles.saved} data-testid="dataset-saved">
                    {saved}
                  </p>
                )}
                <button type="button" className={`button button-primary ${styles.big}`} onClick={record}>
                  ● Record {positionCode(session.position)}
                </button>
                <p className={styles.level} aria-hidden="true">
                  🎤 <LevelBars rms={listening.reading?.rms ?? 0} />
                </p>
                <p className={`muted ${styles.keys}`}>Space: record · Enter: save · R: retake · Esc: discard</p>
              </>
            )}

            {take.step === 'recording' && (
              <>
                <p role="status" className={`${styles.cue} ${take.cue === 'pluck' ? styles.now : ''}`} data-testid="dataset-cue">
                  {take.heard ? 'Got it… let it ring' : take.cue === 'ready' ? 'Get ready…' : `Pluck ${positionCode(take.position)} now!`}
                </p>
                <p className={styles.level} aria-hidden="true">
                  🎤 <LevelBars rms={listening.reading?.rms ?? 0} />
                </p>
                <button type="button" className="button" onClick={() => finishRef.current()}>
                  ■ Stop
                </button>
              </>
            )}

            {take.step === 'review' && (
              <>
                <h2 className={styles.reviewTitle}>Listen to {positionCode(take.position)}</h2>
                <audio className={styles.player} src={take.url} controls autoPlay data-testid="dataset-review-audio" />
                {take.check.warnings.length === 0 ? (
                  <p className={styles.good}>✓ One clear pluck</p>
                ) : (
                  <ul className={styles.warnings} aria-label="Check before saving">
                    {take.check.warnings.map((warning) => (
                      <li key={warning}>⚠ {warning}</li>
                    ))}
                  </ul>
                )}
                <details className={styles.note}>
                  <summary>Add a note</summary>
                  <input type="text" aria-label="Note for this sample" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                </details>
                {take.error && (
                  <p role="alert" className={styles.error}>
                    {take.error}
                  </p>
                )}
                <div className={styles.reviewButtons}>
                  <button type="button" className="button button-primary" onClick={() => void save()} disabled={take.saving}>
                    {take.saving ? 'Saving…' : '✓ Save'}
                  </button>
                  <button type="button" className="button" onClick={retake} disabled={take.saving}>
                    ↺ Retake
                  </button>
                  <button type="button" className="button" onClick={discard} disabled={take.saving}>
                    ✕ Discard
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
