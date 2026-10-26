import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { useAuth } from '../auth/authContext'
import { GuitarPick } from '../components/decor/GuitarPick'
import { PageBanner } from '../components/decor/PageBanner'
import { PlayedStrip } from '../components/practice/PlayedStrip'
import { RatingPicks } from '../components/practice/RatingPicks'
import { deleteSavedPractice, getSavedPractice, listProgress, type SavedPractice, type SavedPracticeDetail } from '../practice/progressApi'
import { useSongRepository } from '../songs/songRepository'
import type { Song } from '../songs/types'
import { timeAgo } from './ShareRequests'
import styles from './ProgressPage.module.css'

/** "What you played" of a saved practice, loaded when opened. */
function SavedRecord({ songId }: { songId: string }) {
  const repository = useSongRepository()
  const [state, setState] = useState<{ song: Song; detail: SavedPracticeDetail } | { error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([repository.getSong(songId), getSavedPractice(songId)]).then(
      ([song, detail]) => {
        if (cancelled) return
        if (!song || !detail || detail.record.length !== song.notes.length) setState({ error: 'This saved practice could not be shown. The song may have changed.' })
        else setState({ song, detail })
      },
      (error: unknown) => !cancelled && setState({ error: error instanceof Error ? error.message : 'Could not load it.' }),
    )
    return () => {
      cancelled = true
    }
  }, [repository, songId])

  if (!state) return <p role="status">Loading what you played…</p>
  if ('error' in state) return <p className="error-box">{state.error}</p>
  return <PlayedStrip notes={state.song.notes} record={state.detail.record} currentIndex={-1} completed />
}

function ProgressCard({ save, onRemoved }: { save: SavedPractice; onRemoved: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    try {
      await deleteSavedPractice(save.songId)
      onRemoved()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'It could not be removed.')
      setBusy(false)
    }
  }

  return (
    <li className={`card ${styles.card}`} data-testid="progress-card">
      <div className={styles.head}>
        <div className={styles.result} aria-hidden={!save.rating}>
          {save.rating ? <RatingPicks rating={save.rating} /> : <span className={styles.unfinished}>{Math.round((save.playedSteps / save.totalSteps) * 100)}%</span>}
        </div>
        <div className={styles.headText}>
          <h2 className={styles.title}>
            <Link to={`/songs/${save.songId}`}>{save.songTitle}</Link>
          </h2>
          <p className={styles.meta}>
            {save.songArtist && <>{save.songArtist} · </>}
            {save.completed ? 'Finished' : `Reached note ${save.playedSteps} of ${save.totalSteps}`} · saved {timeAgo(save.savedAt)}
          </p>
        </div>
        <button type="button" className={styles.remove} aria-label={`Remove saved practice of ${save.songTitle}`} title="Remove" onClick={() => setConfirming(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
        </button>
      </div>

      <ul className={styles.stats} aria-label="Result">
        <li className={styles.right}>
          <strong>{save.rightCount}</strong> right
        </li>
        <li className={save.wrongCount > 0 ? styles.wrong : ''}>
          <strong>{save.wrongCount}</strong> wrong {save.wrongCount === 1 ? 'note' : 'notes'}
        </li>
        <li>
          <span aria-hidden="true">🔥 </span>
          <strong>{save.bestStreak}</strong> in a row
        </li>
        <li>{save.mode === 'flow' ? 'Play through' : 'Note by note'}</li>
      </ul>

      <div className={styles.actions}>
        <Link className={styles.play} to={`/songs/${save.songId}/practice`} aria-label={`Practise ${save.songTitle} again`}>
          <span className={styles.playIcon} aria-hidden="true">
            ▶
          </span>
          Practise again
        </Link>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'What you played'}
        </button>
      </div>

      {confirming && (
        <div className={styles.confirm} role="alertdialog" aria-label={`Remove saved practice of ${save.songTitle}?`}>
          <p>
            <strong>Remove this saved practice?</strong> The song itself stays.
          </p>
          <div className={styles.confirmButtons}>
            <button type="button" className="button button-primary" onClick={remove} disabled={busy}>
              {busy ? 'Removing…' : 'Remove'}
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {error && <p className="error-box">{error}</p>}
      {open && <SavedRecord songId={save.songId} />}
    </li>
  )
}

/** My progress: the practice the student saved, one per song, newest first. */
export function ProgressPage() {
  usePageTitle('My progress')
  const auth = useAuth()
  const [state, setState] = useState<SavedPractice[] | { error: string } | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (auth.status !== 'signedIn') return
    let cancelled = false
    listProgress().then(
      (list) => !cancelled && setState(list),
      (error: unknown) => !cancelled && setState({ error: error instanceof Error ? error.message : 'Your progress could not be loaded.' }),
    )
    return () => {
      cancelled = true
    }
  }, [auth.status, version])

  const list = Array.isArray(state) ? state : []
  const finished = list.filter((s) => s.completed).length
  const picks = list.reduce((sum, s) => sum + (s.rating ?? 0), 0)

  return (
    <div className="page stack">
      <PageBanner kicker="Your practice" title="My progress" headingId="progress-heading">
        <p>Your saved practice, one per song. Practise again to beat your best.</p>
      </PageBanner>

      {auth.status === 'signedOut' && (
        <section className={`card ${styles.empty}`}>
          <GuitarPick className={styles.emptyPick} />
          <p>
            <strong>Sign in to see your progress.</strong> Save a practice after playing, and it appears here.
          </p>
          <div className="button-row">
            <Link className="button button-primary" to="/signin" state={{ from: '/progress' }}>
              Sign in
            </Link>
            <Link className="button" to="/signup" state={{ from: '/progress' }}>
              Create a free account
            </Link>
          </div>
        </section>
      )}

      {auth.status === 'signedIn' && state === null && <p role="status">Loading your progress…</p>}
      {state && !Array.isArray(state) && (
        <p role="alert" className="error-box">
          {state.error}
        </p>
      )}

      {Array.isArray(state) && state.length === 0 && (
        <section className={`card ${styles.empty}`}>
          <GuitarPick className={styles.emptyPick} />
          <p>
            <strong>No saved practice yet.</strong> Practise a song, then tap <strong>💾 Save this practice</strong> under
            “What you played”.
          </p>
          <Link className="button button-primary" to="/songs">
            Choose a song
          </Link>
        </section>
      )}

      {list.length > 0 && (
        <div className={styles.results}>
          <ul className={styles.summary} aria-label="Summary">
            <li>
              <strong>{list.length}</strong> song{list.length === 1 ? '' : 's'} saved
            </li>
            <li>
              <strong>{finished}</strong> finished
            </li>
            <li>
              <GuitarPick className={styles.summaryPick} /> <strong>{picks}</strong> pick{picks === 1 ? '' : 's'} earned
            </li>
          </ul>
          <ol className={styles.list}>
            {list.map((save) => (
              <ProgressCard key={save.songId} save={save} onRemoved={() => setVersion((v) => v + 1)} />
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
