import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
import { usePageTitle } from '../app/usePageTitle'
import { useAuth } from '../auth/authContext'
import { CollectPanel } from '../dataset/CollectPanel'
import { listGuitars, type DatasetGuitar } from '../dataset/datasetApi'
import { SamplesPanel } from '../dataset/SamplesPanel'
import styles from '../dataset/Dataset.module.css'

/**
 * Admin only: the guitar sound dataset collector (record labelled plucks, review, export).
 * The server checks the account on every request; this page only hides itself from others.
 */
export function DatasetPage() {
  usePageTitle('Dataset collector')
  const auth = useAuth()
  const isAdmin = auth.user?.role === 'admin'
  const [tab, setTab] = useState<'record' | 'samples'>('record')
  const [guitars, setGuitars] = useState<DatasetGuitar[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    listGuitars()
      .then(setGuitars)
      .catch((problem) => setError(problem instanceof ApiError ? problem.message : 'Could not load the guitars.'))
  }, [isAdmin, tab])

  if (auth.status === 'loading') return <div className="page">Loading…</div>
  if (!isAdmin) {
    return (
      <div className="page stack">
        <h1>Admins only</h1>
        <p>This page is for the admin.</p>
        <Link className="button" to="/">
          Go to the home page
        </Link>
      </div>
    )
  }

  return (
    <div className={`page ${styles.layout}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>Dataset collector</h1>
        <p className={styles.lead}>Record single plucks with their string and fret, for research.</p>
      </header>
      <div className={styles.tabs} role="group" aria-label="View">
        <button type="button" className={`button ${tab === 'record' ? 'button-primary' : ''}`} aria-pressed={tab === 'record'} onClick={() => setTab('record')}>
          🎙 Record
        </button>
        <button type="button" className={`button ${tab === 'samples' ? 'button-primary' : ''}`} aria-pressed={tab === 'samples'} onClick={() => setTab('samples')}>
          📋 Samples
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {guitars === null && !error && <p>Loading…</p>}
      {guitars && tab === 'record' && <CollectPanel guitars={guitars} onGuitarAdded={(guitar) => setGuitars((list) => [...(list ?? []), guitar])} />}
      {guitars && tab === 'samples' && <SamplesPanel guitars={guitars} />}
    </div>
  )
}
