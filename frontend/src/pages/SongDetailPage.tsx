import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { PageBanner } from '../components/decor/PageBanner'
import { describeNote, scopeLabel } from '../songs/describeNote'
import { getTuning } from '../music/tuning'
import { useSongRepository } from '../songs/songRepository'
import type { Song } from '../songs/types'
import { useSong } from '../songs/useSong'
import { hasLines, startsLine } from '../songs/lines'
import styles from './SongDetailPage.module.css'
import { validateSong } from '../songs/validation'
import { SongStatus } from './SongStatus'

export function SongDetailPage() {
  const { songId } = useParams()
  const state = useSong(songId)
  const song = state.status === 'ready' ? state.value : undefined
  usePageTitle(song?.title ?? 'Song')

  if (!song) return <SongStatus state={state} />

  const issues = validateSong(song)
  const hasMeasures = song.notes.some((note) => note.measure !== undefined)
  const showLines = hasLines(song.notes)
  const hasLyrics = song.notes.some((note) => note.lyric)

  return (
    <div className="page stack">
      <PageBanner kicker="Song" title={song.title} headingId="song-heading">
        {song.artist && <p>{song.artist}</p>}
        {song.description && <p>{song.description}</p>}
      </PageBanner>
      <p className="muted">
        <span aria-hidden="true">{scopeLabel(song.scope).icon} </span>
        {scopeLabel(song.scope).text} · {song.notes.length} notes · {getTuning(song.tuningId)?.name ?? song.tuningId}
        {song.difficulty && ` · ${song.difficulty}`}
      </p>
      {song.canEdit && <SongActions song={song} />}

      {issues.length > 0 ? (
        <div className="error-box" role="alert">
          <h2>This song can&apos;t be practised yet</h2>
          <ul>
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="button-row">
          <Link className="button button-primary" to={`/songs/${song.id}/practice`}>
            Start practice
          </Link>
        </div>
      )}

      <section aria-labelledby="arrangement-heading">
        <h2 id="arrangement-heading">Arrangement</h2>
        <div className="table-scroll card">
          <table>
            <thead>
              <tr>
                <th scope="col">#</th>
                {showLines && <th scope="col">Line</th>}
                {hasMeasures && <th scope="col">Measure</th>}
                <th scope="col">Number</th>
                <th scope="col">Position</th>
                <th scope="col">Note</th>
                <th scope="col">Frequency</th>
                {hasLyrics && <th scope="col">Words</th>}
              </tr>
            </thead>
            <tbody>
              {song.notes.map((note) => {
                const text = describeNote(note)
                return (
                  <tr
                    key={note.index}
                    className={[
                      showLines && startsLine(note, song.notes[note.index - 1]) && note.index > 0 ? styles.lineStart : '',
                      showLines && (note.line ?? 0) % 2 === 0 ? styles.lineEven : '',
                    ].join(' ').trim() || undefined}
                  >
                    <td>{note.index + 1}</td>
                    {showLines && <td>{note.line ?? ''}</td>}
                    {hasMeasures && <td>{note.measure ?? ''}</td>}
                    <td>
                      <strong>{text.number}</strong>
                    </td>
                    <td>{text.position}</td>
                    <td>{text.noteName}</td>
                    <td>{text.frequency}</td>
                    {hasLyrics && <td>{note.lyric ?? ''}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/** Edit and Delete, for the owner of a song (or the admin, for global songs). Deleting asks first. */
function SongActions({ song }: { song: Song }) {
  const repository = useSongRepository()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [share, setShare] = useState(song.shareStatus)
  const ownSong = song.scope === 'mine'

  async function changeShare(action: 'send' | 'withdraw') {
    setBusy(true)
    setError(null)
    try {
      if (action === 'send') await repository.requestShare(song.id)
      else await repository.withdrawShare(song.id)
      setShare(action === 'send' ? 'pending' : undefined)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await repository.deleteSong(song.id)
      navigate(song.scope === 'global' ? '/songs' : '/songs?list=mine', { replace: true })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The song could not be deleted.')
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="button-row">
        <Link className="button" to={`/songs/${song.id}/edit`}>
          Edit song
        </Link>
        {!confirming && (
          <button type="button" className="button" onClick={() => setConfirming(true)}>
            Delete song
          </button>
        )}
        {ownSong && share !== 'pending' && (
          <button type="button" className="button" onClick={() => changeShare('send')} disabled={busy}>
            <span aria-hidden="true">🌍 </span>
            {share === 'rejected' ? 'Share again' : 'Share with everyone'}
          </button>
        )}
      </div>
      {ownSong && share && (
        <p className={share === 'rejected' ? 'error-box' : 'notice'} role="status" data-testid="share-status">
          {share === 'pending' && (
            <>
              ⏳ <strong>Waiting for the admin’s review.</strong>{' '}
              <button type="button" className="button" onClick={() => changeShare('withdraw')} disabled={busy}>
                Withdraw
              </button>
            </>
          )}
          {share === 'approved' && (
            <>
              ✓ <strong>Shared with everyone.</strong> A copy is in the global set list.
            </>
          )}
          {share === 'rejected' && (
            <>
              ✗ <strong>Not accepted for the global set list.</strong>
              {song.shareReason && <> Admin: “{song.shareReason}”</>} You can change it and share again.
            </>
          )}
        </p>
      )}
      {confirming && (
        <div className="error-box" role="alertdialog" aria-labelledby="delete-question">
          <p id="delete-question">
            <strong>Delete “{song.title}”?</strong>{' '}
            {song.scope === 'global' ? 'It will be removed for everyone.' : 'This cannot be undone.'}
          </p>
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete it'}
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
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
