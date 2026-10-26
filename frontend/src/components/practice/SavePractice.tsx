import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/authContext'
import type { PracticeState } from '../../practice/practiceReducer'
import { getSavedPractice, savePractice, type SavedPractice } from '../../practice/progressApi'
import type { Song } from '../../songs/types'
import { PickBurst } from '../decor/PickBurst'
import { RatingPicks } from './RatingPicks'
import styles from './SavePractice.module.css'

/** "2 days ago"-style time, kept local so this component has no page imports. */
function ago(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Saves the practice to My progress when the student chooses to (one saved practice per song:
 * saving again replaces it, after asking). Signed-in students only, for songs on the server.
 */
export function SavePractice({ song, practice }: { song: Song; practice: PracticeState }) {
  const auth = useAuth()
  const location = useLocation()
  const onServer = song.scope === 'global' || song.scope === 'mine'
  const signedIn = auth.status === 'signedIn'
  const [saved, setSaved] = useState<SavedPractice | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(0)
  const played = practice.record.some((step) => step.result !== null || step.wrong.length > 0)

  // The earlier saved practice of this song, if any.
  useEffect(() => {
    if (!signedIn || !onServer) return
    let cancelled = false
    getSavedPractice(song.id).then(
      (found) => !cancelled && setSaved(found),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [signedIn, onServer, song.id])

  // A new attempt (Restart) hides the "Saved" message.
  useEffect(() => setJustSaved(0), [practice.record])

  if (auth.status === 'loading') return null
  if (!signedIn) {
    return (
      <p className={styles.bar}>
        <span aria-hidden="true">💾 </span>
        <Link to="/signin" state={{ from: location.pathname }}>
          Sign in
        </Link>{' '}
        to save your practice and see your progress.
      </p>
    )
  }
  if (!onServer) {
    return (
      <p className={styles.bar}>
        <span aria-hidden="true">💾 </span>Save the song to your songs first, then you can save your practice too.
      </p>
    )
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const result = await savePractice(song.id, {
        mode: practice.mode,
        completed: practice.completed,
        wrongCount: practice.wrongCount,
        bestStreak: practice.bestStreak,
        skippedCount: practice.skippedCount,
        record: practice.record,
      })
      setSaved(result)
      setConfirming(false)
      setJustSaved((n) => n + 1)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The practice could not be saved. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.box} data-testid="save-practice">
      <div className={styles.row}>
        <p className={styles.status}>
          {justSaved > 0 ? (
            <span className={styles.saved} role="status">
              <span className={styles.burst} aria-hidden="true">
                <PickBurst key={justSaved} />
              </span>
              ✓ Saved to <Link to="/progress">My progress</Link>
            </span>
          ) : saved ? (
            <>
              Last saved {ago(saved.savedAt)}
              {saved.rating ? (
                <>
                  {' '}
                  · <RatingPicks rating={saved.rating} small />
                </>
              ) : (
                <> · not finished</>
              )}
            </>
          ) : (
            'Not saved yet'
          )}
        </p>
        {!confirming && (
          <button
            type="button"
            className={`${styles.saveButton} ${practice.completed && justSaved === 0 ? styles.glow : ''}`}
            onClick={() => (saved ? setConfirming(true) : save())}
            disabled={busy || !played}
            title={played ? undefined : 'Play some notes first'}
          >
            <span aria-hidden="true">💾 </span>
            {busy ? 'Saving…' : 'Save this practice'}
          </button>
        )}
      </div>
      {confirming && saved && (
        <div className={styles.confirm} role="alertdialog" aria-label="Replace your saved practice?">
          <p>
            <strong>Replace your saved practice?</strong> You keep one per song: the one from {ago(saved.savedAt)} will be replaced.
          </p>
          <div className={styles.confirmButtons}>
            <button type="button" className="button button-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Replace it'}
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)} disabled={busy}>
              Keep the old one
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </div>
  )
}
