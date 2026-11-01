import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ApiError } from '../api/client'
import { usePageTitle } from '../app/usePageTitle'
import { useAuth } from '../auth/authContext'
import { CollectPanel } from '../dataset/CollectPanel'
import { listGuitars, type DatasetGuitar } from '../dataset/datasetApi'
import { SamplesPanel } from '../dataset/SamplesPanel'
import styles from '../dataset/Dataset.module.css'

/**
 * Recording a guitar for the string check: every signed-in player records their own guitars
 * (record labelled plucks, review them); the admin also sees every guitar and the research
 * details, and exports. The server checks who may do what; visitors are asked to sign in.
 */
export function DatasetPage() {
  const auth = useAuth()
  const user = auth.status === 'signedIn' ? auth.user : null
  const isAdmin = user?.role === 'admin'
  usePageTitle(isAdmin ? 'Dataset collector' : 'Record my guitar')
  const location = useLocation()
  const [tab, setTab] = useState<'record' | 'samples'>('record')
  const [guitars, setGuitars] = useState<DatasetGuitar[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    listGuitars()
      .then(setGuitars)
      .catch((problem) => setError(problem instanceof ApiError ? problem.message : 'Could not load the guitars.'))
  }, [user, tab])

  if (auth.status === 'loading') return <div className="page">Loading…</div>
  if (!user) {
    return (
      <div className="page stack">
        <h1>Record my guitar</h1>
        <p>Sign in to record your guitar, so the string check can tell same-sounding places apart on it.</p>
        <Link className="button button-primary" to="/signin" state={{ from: location.pathname }}>
          Sign in
        </Link>
      </div>
    )
  }

  // A player records into, and sees the recordings of, their own guitars only (the admin: all).
  const own = guitars?.filter((g) => isAdmin || g.mine) ?? null
  const replace = (guitar: DatasetGuitar) => setGuitars((list) => (list ?? []).map((g) => (g.id === guitar.id ? guitar : g)))
  return (
    <div className={`page ${styles.layout}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>{isAdmin ? 'Dataset collector' : 'Record my guitar'}</h1>
        <p className={styles.lead}>
          {isAdmin
            ? 'Record single plucks with their string and fret, for research and the string check.'
            : 'Pluck each place on your guitar 3 times (about 15 minutes, once). Then practice can tell same-sounding places apart, like 10 and 25.'}
        </p>
      </header>
      <div className={styles.tabs} role="group" aria-label="View">
        <button type="button" className={`button ${tab === 'record' ? 'button-primary' : ''}`} aria-pressed={tab === 'record'} onClick={() => setTab('record')}>
          🎙 Record
        </button>
        <button type="button" className={`button ${tab === 'samples' ? 'button-primary' : ''}`} aria-pressed={tab === 'samples'} onClick={() => setTab('samples')}>
          📋 {isAdmin ? 'Samples' : 'My recordings'}
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {own === null && !error && <p>Loading…</p>}
      {own && tab === 'record' && (
        <CollectPanel guitars={own} admin={isAdmin} userId={user.id} onGuitarAdded={(guitar) => setGuitars((list) => [...(list ?? []), guitar])} />
      )}
      {own && tab === 'samples' && <SamplesPanel guitars={own} admin={isAdmin} onGuitarChanged={replace} />}
    </div>
  )
}
