import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { decodeWav } from '../audio/wav'
import { listSamples, sampleAudio, saveSampleFingerprint, setDefaultGuitar, type DatasetGuitar, type DatasetSample } from './datasetApi'
import { fingerprint, measureRecording } from './soundMatch'
import styles from './Dataset.module.css'

/** Older recordings are read this many at a time (the slow part is the download). */
export const PARALLEL_DOWNLOADS = 4

type State = { step: 'idle' } | { step: 'working'; done: number; total: number } | { step: 'done'; made: number; failed: number } | { step: 'error'; text: string }

/** The guitar's kept recordings that have no fingerprint yet (all pages). */
async function olderOf(guitarId: string): Promise<DatasetSample[]> {
  const all: DatasetSample[] = []
  for (let page = 1; ; page++) {
    const found = await listSamples({ guitarId }, page, 100)
    all.push(...found.items)
    if (all.length >= found.total || found.items.length === 0) break
  }
  return all.filter((s) => s.status !== 'rejected' && !s.hasFingerprint)
}

/**
 * Sound match for one guitar. New recordings get their fingerprint when they are made; recordings
 * made before that are updated here: each is read through the API, measured in this browser by the
 * app's own tracker, and its fingerprint saved at once (stopping halfway loses nothing). The admin
 * also chooses here which guitar players are compared with before they choose one.
 */
export function SoundMatchCard({ guitar, admin, onChanged }: { guitar: DatasetGuitar; admin: boolean; onChanged: (guitar: DatasetGuitar) => void }) {
  const [state, setState] = useState<State>({ step: 'idle' })
  const [defaultError, setDefaultError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function update() {
    setState({ step: 'working', done: 0, total: 0 })
    try {
      const older = await olderOf(guitar.id)
      let done = 0
      let made = 0
      let failed = 0
      setState({ step: 'working', done, total: older.length })
      const queue = [...older]
      const worker = async () => {
        for (let sample = queue.shift(); sample && alive.current; sample = queue.shift()) {
          try {
            const sound = decodeWav(await sampleAudio(sample.id))
            const v = fingerprint(measureRecording(sound.samples, sound.sampleRate, sample.expectedMidi))
            if (v) {
              await saveSampleFingerprint(sample.id, v)
              made++
            } else failed++
          } catch {
            failed++
          }
          done++
          if (alive.current) setState({ step: 'working', done, total: older.length })
        }
      }
      await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker))
      if (!alive.current) return
      onChanged({ ...guitar, fingerprints: guitar.fingerprints + made, missingFingerprints: Math.max(0, guitar.missingFingerprints - made) })
      setState({ step: 'done', made, failed })
    } catch (problem) {
      if (alive.current) setState({ step: 'error', text: problem instanceof ApiError ? problem.message : 'Could not update the recordings. Please try again.' })
    }
  }

  async function changeDefault(isDefault: boolean) {
    setDefaultError(null)
    try {
      onChanged(await setDefaultGuitar(guitar.id, isDefault))
    } catch (problem) {
      setDefaultError(problem instanceof ApiError ? problem.message : 'Could not change it. Please try again.')
    }
  }

  return (
    <section className={`card ${styles.soundMatch}`} aria-label="Sound match">
      <p>
        <strong>String check with {guitar.name}</strong>
        <br />
        <span className="muted">
          {guitar.fingerprints > 0
            ? `${guitar.fingerprints} recordings ready: practice can compare same-sounding places with them.`
            : 'No recordings ready yet.'}
        </span>
      </p>
      {guitar.missingFingerprints > 0 &&
        (state.step === 'working' ? (
          <p role="status">{state.total ? `Updating ${state.done} of ${state.total}…` : 'Finding the older recordings…'}</p>
        ) : (
          <button type="button" className="button" onClick={() => void update()}>
            Update {guitar.missingFingerprints} older recordings
          </button>
        ))}
      {state.step === 'done' && (
        <p role="status" data-testid="sound-match-ready">
          Updated {state.made} recordings{state.failed > 0 ? ` (${state.failed} could not be measured)` : ''}.
        </p>
      )}
      {state.step === 'error' && (
        <p role="alert" className={styles.error}>
          {state.text}
        </p>
      )}
      {admin && (
        <label className={styles.defaultPick}>
          <input type="checkbox" checked={guitar.isDefault} onChange={(e) => void changeDefault(e.target.checked)} />
          <span>Default guitar for players (used only when it matches their guitar)</span>
        </label>
      )}
      {defaultError && (
        <p role="alert" className={styles.error}>
          {defaultError}
        </p>
      )}
    </section>
  )
}
