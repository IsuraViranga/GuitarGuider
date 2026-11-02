import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ApiError } from '../api/client'
import { usePageTitle } from '../app/usePageTitle'
import { useAuth } from '../auth/authContext'
import { CollectPanel } from '../dataset/CollectPanel'
import { listGuitars, type DatasetGuitar, type SampleFilters } from '../dataset/datasetApi'
import type { Position } from '../dataset/pluck'
import { SamplesPanel } from '../dataset/SamplesPanel'
import { TestPanel } from '../dataset/TestPanel'
import styles from '../dataset/Dataset.module.css'

/**
 * Recording a guitar for the string check: every signed-in player records their own guitars
 * (record labelled plucks, review them); the admin also sees every guitar and the research
 * details, and exports. Test my guitar: play a note and see which string the recordings name. The server checks who may do what; visitors are asked to sign in.
 */
export function DatasetPage() {
  const auth = useAuth()
  const user = auth.status === 'signedIn' ? auth.user : null
  const isAdmin = user?.role === 'admin'
  usePageTitle(isAdmin ? 'Dataset collector' : 'Record my guitar')
  const location = useLocation()
  const [tab, setTab] = useState<'record' | 'samples' | 'test'>('record')
  /** The guitar to test first (the one just finished recording). */
  const [testGuitar, setTestGuitar] = useState<string | null>(null)
  /** From Test my guitar: record at this guitar and place, or see its recordings. */
  const [recordAt, setRecordAt] = useState<{ guitarId: string; position: Position } | undefined>(undefined)
  const [samplesOf, setSamplesOf] = useState<SampleFilters | undefined>(undefined)
  /** A tab chosen by the player starts as usual (not at a place the test asked for). */
  const open = (next: typeof tab) => {
    setRecordAt(undefined)
    setSamplesOf(undefined)
    setTab(next)
  }
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
        <button type="button" className={`button ${tab === 'record' ? 'button-primary' : ''}`} aria-pressed={tab === 'record'} onClick={() => open('record')}>
          🎙 Record
        </button>
        <button type="button" className={`button ${tab === 'samples' ? 'button-primary' : ''}`} aria-pressed={tab === 'samples'} onClick={() => open('samples')}>
          📋 {isAdmin ? 'Samples' : 'My recordings'}
        </button>
        <button type="button" className={`button ${tab === 'test' ? 'button-primary' : ''}`} aria-pressed={tab === 'test'} onClick={() => open('test')}>
          🎯 Test
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {own === null && !error && <p>Loading…</p>}
      {own && tab === 'record' && (
        <CollectPanel
          guitars={own}
          admin={isAdmin}
          userId={user.id}
          start={recordAt}
          onGuitarAdded={(guitar) => setGuitars((list) => [...(list ?? []), guitar])}
          onTest={(guitarId) => {
            setTestGuitar(guitarId)
            setTab('test')
          }}
        />
      )}
      {own && tab === 'samples' && <SamplesPanel guitars={own} admin={isAdmin} onGuitarChanged={replace} initialFilters={samplesOf} />}
      {guitars && tab === 'test' && (
        <TestPanel
          guitars={guitars.filter((g) => g.fingerprints > 0)}
          preferredGuitarId={testGuitar}
          admin={isAdmin}
          onAddRecording={(guitarId, position) => {
            setTestGuitar(guitarId)
            setRecordAt({ guitarId, position: { stringNumber: position.stringNumber, fret: position.fret } })
            setTab('record')
          }}
          onCheckRecordings={(guitarId, position) => {
            setTestGuitar(guitarId)
            setSamplesOf({ guitarId, stringNumber: position.stringNumber, fret: position.fret })
            setTab('samples')
          }}
        />
      )}
    </div>
  )
}
