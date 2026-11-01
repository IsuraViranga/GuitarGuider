import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { decodeWav } from '../audio/wav'
import type { StringNumber } from '../music/tuning'
import { listSamples, sampleAudio, saveFingerprints, type DatasetGuitar, type DatasetSample, type FingerprintRow } from './datasetApi'
import { countPairs, createSoundMatch, fingerprint, measureRecording } from './soundMatch'
import styles from './Dataset.module.css'

type State =
  | { step: 'idle' }
  | { step: 'working'; done: number; total: number }
  | { step: 'done'; plucks: number; skipped: number; on: number; total: number }
  | { step: 'error'; text: string }

/** Every sample of the guitar that is not rejected (all pages). */
async function samplesOf(guitarId: string): Promise<DatasetSample[]> {
  const all: DatasetSample[] = []
  for (let page = 1; ; page++) {
    const found = await listSamples({ guitarId }, page, 100)
    all.push(...found.items)
    if (all.length >= found.total || found.items.length === 0) break
  }
  return all.filter((s) => s.status !== 'rejected')
}

/**
 * Sound match (admin test): makes a fingerprint from every recording of this guitar, in this
 * browser with the app's own tracker (as practice hears a pluck), and keeps them on the server.
 * Practice can then compare plucks on this guitar with them.
 */
export function SoundMatchCard({ guitar, onPrepared }: { guitar: DatasetGuitar; onPrepared: (guitar: DatasetGuitar) => void }) {
  const [state, setState] = useState<State>({ step: 'idle' })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function prepare() {
    setState({ step: 'working', done: 0, total: 0 })
    try {
      const samples = await samplesOf(guitar.id)
      const rows: FingerprintRow[] = []
      for (const [i, sample] of samples.entries()) {
        if (!alive.current) return
        setState({ step: 'working', done: i, total: samples.length })
        const sound = decodeWav(await sampleAudio(sample.id))
        const v = fingerprint(measureRecording(sound.samples, sound.sampleRate, sample.expectedMidi))
        if (v) rows.push({ sampleId: sample.id, stringNumber: sample.stringNumber, fret: sample.fret, v })
        // Let the page draw the progress between recordings.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      const saved = await saveFingerprints(guitar.id, rows)
      if (!alive.current) return
      onPrepared(saved)
      const pairs = countPairs(createSoundMatch(rows.map((r) => ({ stringNumber: r.stringNumber as StringNumber, fret: r.fret, v: r.v }))))
      setState({ step: 'done', plucks: rows.length, skipped: samples.length - rows.length, ...pairs })
    } catch (problem) {
      if (alive.current) setState({ step: 'error', text: problem instanceof ApiError ? problem.message : 'Could not prepare the sound match. Please try again.' })
    }
  }

  return (
    <section className={`card ${styles.soundMatch}`} aria-label="Sound match">
      <p>
        <strong>Sound match for {guitar.name}</strong>
        <br />
        <span className="muted">
          {guitar.fingerprints > 0
            ? `Ready: ${guitar.fingerprints} plucks. Practice can compare plucks on this guitar with them.`
            : 'Practice can compare plucks on this guitar with its recordings, once they are prepared.'}
        </span>
      </p>
      {state.step === 'working' ? (
        <p role="status">{state.total ? `Preparing ${state.done + 1} of ${state.total}…` : 'Finding the recordings…'}</p>
      ) : (
        <button type="button" className="button" onClick={() => void prepare()}>
          {guitar.fingerprints > 0 ? 'Prepare again' : 'Prepare sound match from these recordings'}
        </button>
      )}
      {state.step === 'done' && (
        <p role="status" data-testid="sound-match-ready">
          Ready: {state.plucks} plucks{state.skipped > 0 ? ` (${state.skipped} could not be measured)` : ''}. {state.on} of {state.total} same-note pairs
          can be told apart on this guitar.
        </p>
      )}
      {state.step === 'error' && (
        <p role="alert" className={styles.error}>
          {state.text}
        </p>
      )}
    </section>
  )
}
