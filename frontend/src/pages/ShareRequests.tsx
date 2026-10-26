// The admin's side of sharing: the list of songs waiting for review, the review page (approve,
// edit and approve, reject with an optional reason) and the "edit and approve" editor.

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { usePageTitle } from '../app/usePageTitle'
import { useAuth } from '../auth/authContext'
import { Celebration } from '../components/decor/Celebration'
import { GuitarPick } from '../components/decor/GuitarPick'
import { PageBanner } from '../components/decor/PageBanner'
import { useSongRepository, type ShareRequest, type ShareRequestDetail } from '../songs/songRepository'
import { ImportPage, SongPreview } from './ImportPage'
import styles from './ShareRequests.module.css'

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", or the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** How many requests are waiting (admin only; 0 otherwise). Reloads when `version` changes. */
export function useWaitingRequests(isAdmin: boolean, version = 0): number {
  const repository = useSongRepository()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    repository.listShareRequests('pending').then(
      (requests) => !cancelled && setCount(requests.length),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [repository, isAdmin, version])
  return isAdmin ? count : 0
}

function RequestCard({ request }: { request: ShareRequest }) {
  return (
    <li className={`card ${styles.request}`} data-status={request.status}>
      <div className={styles.requestHead}>
        <span className={styles.avatar} aria-hidden="true">
          {request.requesterName.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className={styles.requestText}>
          <h3 className={styles.requestTitle}>{request.title}</h3>
          <p className={styles.requestMeta}>
            {request.artist && <>{request.artist} · </>}
            From <strong>{request.requesterName}</strong> · {timeAgo(request.createdAt)}
          </p>
        </div>
      </div>
      <p className={styles.requestBadges}>
        {request.chordCount > 0 && <span className="badge">{request.chordCount} chords</span>}
        {request.noteCount > request.chordCount && <span className="badge">{request.noteCount - request.chordCount} notes</span>}
        {request.status === 'approved' && <span className={`badge ${styles.approved}`}>✓ Approved</span>}
        {request.status === 'rejected' && <span className={`badge ${styles.rejected}`}>✗ Not accepted</span>}
      </p>
      {request.status === 'pending' && (
        <Link className={`button button-primary ${styles.reviewButton}`} to={`/requests/${request.id}`} aria-label={`Review ${request.title}`}>
          Review <span aria-hidden="true">›</span>
        </Link>
      )}
    </li>
  )
}

/** The Requests tab: songs waiting for review first, then the most recently reviewed. */
export function ShareRequestList({ onReviewed: _onReviewed }: { onReviewed?: () => void }) {
  const repository = useSongRepository()
  // After "edit and approve" the editor comes back here with the song's title.
  const approved = (useLocation().state as { approved?: string } | null)?.approved
  const [state, setState] = useState<{ pending: ShareRequest[]; reviewed: ShareRequest[] } | { error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([repository.listShareRequests('pending'), repository.listShareRequests('reviewed')]).then(
      ([pending, reviewed]) => !cancelled && setState({ pending, reviewed }),
      (error: unknown) => !cancelled && setState({ error: error instanceof Error ? error.message : 'The requests could not be loaded.' }),
    )
    return () => {
      cancelled = true
    }
  }, [repository])

  if (!state) return <p role="status">Loading requests…</p>
  if ('error' in state) {
    return (
      <p role="alert" className="error-box">
        {state.error}
      </p>
    )
  }
  return (
    <section className="stack" aria-labelledby="requests-heading">
      {approved && (
        <>
          <Celebration />
          <p className={`notice ${styles.sharedNotice}`} role="status">
            <span aria-hidden="true">✓ </span>“{approved}” is now shared with everyone.
          </p>
        </>
      )}
      <h2 id="requests-heading" className={styles.sectionTitle}>
        Waiting for your review
      </h2>
      {state.pending.length === 0 ? (
        <div className={`card ${styles.empty}`}>
          <GuitarPick className={styles.emptyPick} />
          <p>
            <strong>All caught up.</strong> No songs are waiting. When someone shares a song, it appears here.
          </p>
        </div>
      ) : (
        <ol className={styles.requestList} data-testid="pending-requests">
          {state.pending.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </ol>
      )}
      {state.reviewed.length > 0 && (
        <details className={styles.reviewed}>
          <summary>Recently reviewed ({state.reviewed.length})</summary>
          <ol className={styles.requestList}>
            {state.reviewed.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}

type Outcome = { kind: 'approved'; request: ShareRequest } | { kind: 'rejected'; request: ShareRequest }

/** One request: the song as it was sent, and Approve / Edit and approve / Reject. */
export function ReviewRequestPage() {
  const { requestId = '' } = useParams()
  const repository = useSongRepository()
  const navigate = useNavigate()
  const auth = useAuth()
  const [detail, setDetail] = useState<ShareRequestDetail | { error: string; code?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  usePageTitle(detail && 'title' in detail ? `Review ${detail.title}` : 'Review request')

  useEffect(() => {
    let cancelled = false
    repository.getShareRequest(requestId).then(
      (found) => !cancelled && setDetail(found),
      (problem: unknown) =>
        !cancelled &&
        setDetail({ error: problem instanceof Error ? problem.message : 'The request could not be loaded.', code: problem instanceof ApiError ? problem.status : undefined }),
    )
    return () => {
      cancelled = true
    }
  }, [repository, requestId])

  async function decide(action: () => Promise<ShareRequest>, kind: Outcome['kind']) {
    setBusy(true)
    setError(null)
    try {
      setOutcome({ kind, request: await action() })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (auth.status === 'signedOut' || (auth.user && auth.user.role !== 'admin')) {
    return (
      <div className="page stack">
        <h1>Review request</h1>
        <p role="alert" className="error-box">
          Only the admin can review shared songs.
        </p>
      </div>
    )
  }
  if (!detail) return <p className="page" role="status">Loading the request…</p>
  if ('error' in detail) {
    return (
      <div className="page stack">
        <h1>Review request</h1>
        <p role="alert" className="error-box">
          {detail.error} <Link to="/songs?list=requests">Back to requests</Link>
        </p>
      </div>
    )
  }

  if (outcome) {
    return (
      <div className="page stack">
        {outcome.kind === 'approved' && <Celebration />}
        <section className={`card ${styles.outcome} ${outcome.kind === 'approved' ? styles.outcomeApproved : styles.outcomeRejected}`} aria-live="polite">
          <span className={styles.outcomeIcon} aria-hidden="true">
            {outcome.kind === 'approved' ? '✓' : '✗'}
          </span>
          <h1 className={styles.outcomeTitle}>{outcome.kind === 'approved' ? 'Shared with everyone!' : 'Not accepted'}</h1>
          <p>
            {outcome.kind === 'approved'
              ? `“${detail.title}” is now in the global set list. ${detail.requesterName} will see that it was shared.`
              : `${detail.requesterName} will see that “${detail.title}” was not accepted${outcome.request.reason ? ', with your reason' : ''}.`}
          </p>
          <div className="button-row">
            {outcome.kind === 'approved' && outcome.request.globalSongId && (
              <Link className="button button-primary" to={`/songs/${outcome.request.globalSongId}`}>
                Open the song
              </Link>
            )}
            <Link className="button" to="/songs?list=requests">
              Back to requests
            </Link>
          </div>
        </section>
      </div>
    )
  }

  const pending = detail.status === 'pending'
  return (
    <div className="page stack">
      <PageBanner kicker="Share request" title={detail.title} headingId="review-heading">
        <p>
          {detail.artist && <>{detail.artist} · </>}
          From <strong>{detail.requesterName}</strong> · sent {timeAgo(detail.createdAt)}
        </p>
      </PageBanner>

      {!pending && (
        <p className="notice" role="status">
          This request was already {detail.status === 'approved' ? 'approved' : 'not accepted'}.
        </p>
      )}

      {pending && (
        <section className={`card ${styles.decision}`} aria-labelledby="decision-heading">
          <h2 id="decision-heading" className={styles.sectionTitle}>
            Your decision
          </h2>
          <p className="muted">Check the notes and words below. Approving adds a copy to the global set list; the sender keeps their own song.</p>
          <div className={styles.decisionButtons}>
            <button type="button" className="button button-primary" onClick={() => decide(() => repository.approveShareRequest(detail.id), 'approved')} disabled={busy}>
              <span aria-hidden="true">✓ </span>
              {busy && !rejecting ? 'Approving…' : 'Approve'}
            </button>
            <Link className="button" to={`/requests/${detail.id}/edit`}>
              <span aria-hidden="true">✎ </span>Edit and approve
            </Link>
            <button type="button" className={`button ${styles.rejectButton}`} aria-expanded={rejecting} onClick={() => setRejecting(true)} disabled={busy}>
              <span aria-hidden="true">✗ </span>Reject
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                repository.practiseWithoutSaving(detail.song)
                navigate('/songs/draft/practice')
              }}
            >
              <span aria-hidden="true">▶ </span>Try it
            </button>
          </div>
          {rejecting && (
            <div className={styles.rejectBox}>
              <label htmlFor="reject-reason">
                Reason for {detail.requesterName} <span className="muted">(optional)</span>
              </label>
              <textarea id="reject-reason" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: please add the words under the numbers." />
              <div className="button-row">
                <button type="button" className={`button ${styles.rejectConfirm}`} onClick={() => decide(() => repository.rejectShareRequest(detail.id, reason), 'rejected')} disabled={busy}>
                  {busy ? 'Sending…' : 'Reject song'}
                </button>
                <button type="button" className="button" onClick={() => setRejecting(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
        </section>
      )}

      <section className="card stack" aria-labelledby="sent-heading">
        <h2 id="sent-heading" className={styles.sectionTitle}>
          The song as sent · {detail.noteCount} steps
        </h2>
        <SongPreview notes={detail.song.notes} />
      </section>

      <p>
        <Link to="/songs?list=requests">‹ Back to requests</Link>
      </p>
    </div>
  )
}

/** "Edit and approve": the Add a song editor with the song as sent; saving publishes the corrected version. */
export function ApproveWithChangesPage() {
  const { requestId = '' } = useParams()
  const repository = useSongRepository()
  const [detail, setDetail] = useState<ShareRequestDetail | { error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    repository.getShareRequest(requestId).then(
      (found) => !cancelled && setDetail(found),
      (problem: unknown) => !cancelled && setDetail({ error: problem instanceof Error ? problem.message : 'The request could not be loaded.' }),
    )
    return () => {
      cancelled = true
    }
  }, [repository, requestId])

  if (!detail) return <p className="page" role="status">Loading the request…</p>
  if ('error' in detail) {
    return (
      <div className="page stack">
        <h1>Edit and approve</h1>
        <p role="alert" className="error-box">
          {detail.error}
        </p>
      </div>
    )
  }
  if (detail.status !== 'pending') {
    return (
      <div className="page stack">
        <h1>Edit and approve</h1>
        <p className="notice">
          This request has already been reviewed. <Link to="/songs?list=requests">Back to requests</Link>
        </p>
      </div>
    )
  }
  return <ImportPage key={detail.id} editSong={detail.song} review={{ requestId: detail.id, requesterName: detail.requesterName }} />
}
