import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { download } from '../audio/saveRecording'
import { DEFAULT_MAX_FRET } from '../music/tuning'
import {
  audioUrl,
  changeSample,
  deleteSample,
  exportSamples,
  listSamples,
  type DatasetGuitar,
  type DatasetSample,
  type Noise,
  type ReviewStatus,
  type SampleFilters,
  type SamplePage,
  type StringMaterial,
} from './datasetApi'
import styles from './Dataset.module.css'

const PAGE_SIZE = 20
const STATUS_LABELS: Record<ReviewStatus, string> = { accepted: 'Accepted', needs_review: 'Needs review', rejected: 'Rejected' }

const message = (problem: unknown, fallback: string) => (problem instanceof ApiError ? problem.message : fallback)

/** The saved samples: filter, play, mark, delete, and export the labels for later research. */
export function SamplesPanel({ guitars }: { guitars: DatasetGuitar[] }) {
  const [filters, setFilters] = useState<SampleFilters>({})
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<SamplePage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    listSamples(filters, page, PAGE_SIZE)
      .then((found) => {
        if (!current) return
        setResult(found)
        setError(null)
      })
      .catch((problem) => current && setError(message(problem, 'Could not load the samples.')))
    return () => {
      current = false
    }
  }, [filters, page, reload])

  const filter = (change: Partial<SampleFilters>) => {
    setFilters((current) => {
      const next = { ...current, ...change }
      for (const key of Object.keys(next) as (keyof SampleFilters)[]) if (next[key] === undefined) delete next[key]
      return next
    })
    setPage(1)
  }
  const replace = (sample: DatasetSample) => setResult((r) => r && { ...r, items: r.items.map((s) => (s.id === sample.id ? sample : s)) })

  async function play(sample: DatasetSample) {
    setRowError(null)
    try {
      setPlaying({ id: sample.id, url: await audioUrl(sample.id) })
    } catch (problem) {
      setRowError({ id: sample.id, text: message(problem, 'Could not play it.') })
    }
  }
  async function mark(sample: DatasetSample, status: ReviewStatus) {
    setRowError(null)
    try {
      replace(await changeSample(sample.id, { status }))
    } catch (problem) {
      setRowError({ id: sample.id, text: message(problem, 'Could not change it.') })
    }
  }
  async function editNote(sample: DatasetSample, notes: string) {
    if ((sample.notes ?? '') === notes.trim()) return
    setRowError(null)
    try {
      replace(await changeSample(sample.id, { notes: notes.trim() || null }))
    } catch (problem) {
      setRowError({ id: sample.id, text: message(problem, 'Could not save the note.') })
    }
  }
  async function remove(sample: DatasetSample) {
    setRowError(null)
    try {
      await deleteSample(sample.id)
      setConfirmDelete(null)
      if (playing?.id === sample.id) setPlaying(null)
      setReload((n) => n + 1)
    } catch (problem) {
      setRowError({ id: sample.id, text: message(problem, 'Could not delete it.') })
    }
  }
  async function exportAs(format: 'csv' | 'jsonl') {
    setExportError(null)
    try {
      download(await exportSamples(filters, format), `guitar-dataset.${format}`)
    } catch (problem) {
      setExportError(message(problem, 'Could not export.'))
    }
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1
  const number = (value: string) => (value === '' ? undefined : Number(value))

  return (
    <div className={styles.samples}>
      <section className={`card ${styles.filters}`} aria-label="Filters">
        <label>
          Guitar
          <select className={styles.select} value={filters.guitarId ?? ''} onChange={(e) => filter({ guitarId: e.target.value || undefined })}>
            <option value="">All</option>
            {guitars.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          String
          <select className={styles.select} value={filters.stringNumber ?? ''} onChange={(e) => filter({ stringNumber: number(e.target.value) })}>
            <option value="">All</option>
            {[1, 2, 3, 4, 5, 6].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fret
          <select className={styles.select} value={filters.fret ?? ''} onChange={(e) => filter({ fret: number(e.target.value) })}>
            <option value="">All</option>
            {Array.from({ length: DEFAULT_MAX_FRET + 1 }, (_, f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Strings
          <select className={styles.select} value={filters.stringMaterial ?? ''} onChange={(e) => filter({ stringMaterial: (e.target.value || undefined) as StringMaterial | undefined })}>
            <option value="">All</option>
            <option value="steel">Steel</option>
            <option value="nylon">Nylon</option>
            <option value="unknown">Not sure</option>
          </select>
        </label>
        <label>
          Noise
          <select className={styles.select} value={filters.backgroundNoise ?? ''} onChange={(e) => filter({ backgroundNoise: (e.target.value || undefined) as Noise | undefined })}>
            <option value="">All</option>
            <option value="quiet">Quiet</option>
            <option value="moderate">Moderate</option>
            <option value="noisy">Noisy</option>
          </select>
        </label>
        <label>
          Status
          <select className={styles.select} value={filters.status ?? ''} onChange={(e) => filter({ status: (e.target.value || undefined) as ReviewStatus | undefined })}>
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.exportButtons}>
          <button type="button" className="button" onClick={() => void exportAs('csv')}>
            ⬇ CSV
          </button>
          <button type="button" className="button" onClick={() => void exportAs('jsonl')}>
            ⬇ JSONL
          </button>
        </div>
        {exportError && (
          <p role="alert" className={styles.error}>
            {exportError}
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="muted" data-testid="dataset-total">
            {result.total === 1 ? '1 sample' : `${result.total} samples`}
          </p>
          <ul className={styles.sampleList}>
            {result.items.map((sample) => (
              <li key={sample.id} className={`card ${styles.sample}`} data-testid="dataset-sample">
                <div className={styles.sampleHead}>
                  <span className={styles.sampleCode}>{sample.position}</span>
                  <span>
                    <strong>
                      {sample.expectedNote} · {sample.expectedHz.toFixed(2)} Hz
                    </strong>{' '}
                    <span className="muted">· {sample.stringConstruction}</span>
                    <br />
                    <span className="muted">
                      {sample.guitarName} · {sample.backgroundNoise} · {sample.pluckMethod} · {sample.pluckStrength}
                      {sample.device ? ` · ${sample.device}` : ''}
                    </span>
                    <br />
                    <span className="muted">
                      {new Date(sample.recordedAt).toLocaleString()} · {(sample.durationMs / 1000).toFixed(1)} s · {sample.sampleRate / 1000} kHz · peak{' '}
                      {sample.peak.toFixed(2)}
                    </span>
                  </span>
                </div>
                {playing?.id === sample.id && <audio className={styles.player} src={playing.url} controls autoPlay />}
                <div className={styles.sampleActions}>
                  <button type="button" className="button" onClick={() => void play(sample)}>
                    ▶ Play
                  </button>
                  <label className={styles.statusPick}>
                    <span className="visually-hidden">Status of {sample.position}</span>
                    <select className={styles.select} value={sample.status} onChange={(e) => void mark(sample, e.target.value as ReviewStatus)}>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    type="text"
                    className={styles.noteInput}
                    aria-label={`Note for ${sample.position}`}
                    placeholder="Note"
                    maxLength={500}
                    defaultValue={sample.notes ?? ''}
                    onBlur={(e) => void editNote(sample, e.target.value)}
                  />
                  {confirmDelete === sample.id ? (
                    <span className={styles.confirm} role="alertdialog" aria-label={`Delete sample ${sample.position}?`}>
                      Delete for good?
                      <button type="button" className="button button-primary" onClick={() => void remove(sample)}>
                        Delete
                      </button>
                      <button type="button" className="button" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="button" onClick={() => setConfirmDelete(sample.id)}>
                      🗑 Delete
                    </button>
                  )}
                </div>
                {rowError?.id === sample.id && (
                  <p role="alert" className={styles.error}>
                    {rowError.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav className={styles.pager} aria-label="Pages">
              <button type="button" className="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ← Newer
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button type="button" className="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Older →
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
