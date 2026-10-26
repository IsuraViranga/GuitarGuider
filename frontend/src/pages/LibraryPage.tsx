import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import seated from '../assets/brand/melantha-seated.jpg'
import { useAuth } from '../auth/authContext'
import { PageBanner } from '../components/decor/PageBanner'
import { GuitarPick } from '../components/decor/GuitarPick'
import { scopeLabel } from '../songs/describeNote'
import { useSongRepository, type SongSummary } from '../songs/songRepository'
import type { Difficulty, ShareStatus, Song } from '../songs/types'
import { useSongList } from '../songs/useSong'
import styles from './LibraryPage.module.css'
import { ShareRequestList, useWaitingRequests } from './ShareRequests'

const PICKS: Record<Difficulty, number> = { beginner: 1, intermediate: 2, advanced: 3 }
const SINHALA = /[඀-෿]/

function DifficultyPicks({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className={styles.difficulty}>
      <span className={styles.picks} aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <GuitarPick key={n} className={styles.pick} filled={n <= PICKS[difficulty]} />
        ))}
      </span>
      {difficulty}
    </span>
  )
}

/** Small line icons for the card buttons (decorative: the buttons have names). */
const PencilIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
)
const BinIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
)
const NoteIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </svg>
)

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </svg>
)

const SHARE_LABELS: Record<ShareStatus, { icon: string; text: string }> = {
  pending: { icon: '⏳', text: 'Waiting for the admin’s review' },
  approved: { icon: '✓', text: 'Shared with everyone' },
  rejected: { icon: '✗', text: 'Not accepted for the global set list.' },
}

function deviceSummary(song: Song): SongSummary {
  return {
    id: song.id,
    title: song.title,
    scope: 'device',
    canEdit: false,
    noteCount: song.notes.length,
    chordCount: song.notes.filter((n) => n.chord).length,
    ...(song.difficulty ? { difficulty: song.difficulty } : {}),
  }
}

/**
 * One song in the set list: numbered cover, title (opens the song), artist, badges, and the
 * buttons: Practise, then Edit and Delete for songs you may change, or Notes for the others.
 */
function SongCard({ song, number, onChanged }: { song: SongSummary; number: number; onChanged: () => void }) {
  const where = scopeLabel(song.scope)
  const repository = useSongRepository()
  const [confirming, setConfirming] = useState<'delete' | 'share' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Your own songs can be offered to the global set list, unless a request is waiting or it is
  // already shared (sharing again would make a second global copy).
  const canShare = song.scope === 'mine' && song.canEdit && song.shareStatus !== 'pending' && song.shareStatus !== 'approved'

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setConfirming(null)
      setBusy(false)
      onChanged()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : failure)
      setBusy(false)
    }
  }
  const remove = () => run(() => repository.deleteSong(song.id), 'The song could not be deleted.')
  const share = () => run(() => repository.requestShare(song.id), 'The song could not be sent to the admin.')
  const withdraw = () => run(() => repository.withdrawShare(song.id), 'The request could not be withdrawn.')

  return (
    <li className={`card ${styles.item}`} data-scope={song.scope}>
      <div className={styles.head}>
        <span className={styles.cover} aria-hidden="true">
          <GuitarPick className={styles.coverPick} />
          <span className={styles.track}>{String(number).padStart(2, '0')}</span>
        </span>
        <div className={styles.headText}>
          <h2 className={styles.title}>
            <Link to={`/songs/${song.id}`}>
              {song.title}
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </Link>
          </h2>
          {song.artist && <p className={styles.artist}>{song.artist}</p>}
          {song.difficulty && <DifficultyPicks difficulty={song.difficulty} />}
        </div>
      </div>
      {song.description && <p className={styles.description}>{song.description}</p>}
      <p className={styles.meta}>
        <span className={`badge ${styles.where} ${styles[`where_${song.scope}`]}`}>
          <span aria-hidden="true">{where.icon} </span>
          {where.text}
        </span>
        {SINHALA.test(song.title) && <span className={`badge ${styles.sinhala}`}>සිංහල</span>}
        {song.chordCount > 0 && <span className="badge">{song.chordCount} chords</span>}
        {song.noteCount > song.chordCount && <span className="badge">{song.noteCount - song.chordCount} notes</span>}
      </p>
      {song.scope === 'mine' && song.shareStatus && (
        <div className={`${styles.share} ${styles[`share_${song.shareStatus}`]}`} data-testid="share-status">
          <p>
            <span aria-hidden="true">{SHARE_LABELS[song.shareStatus].icon} </span>
            <strong>{SHARE_LABELS[song.shareStatus].text}</strong>
            {song.shareStatus === 'rejected' && song.shareReason && <span className={styles.shareReason}> Admin: “{song.shareReason}”</span>}
            {song.shareStatus === 'rejected' && <span className={styles.shareHint}> You can change it and share again.</span>}
          </p>
          {song.shareStatus === 'pending' && (
            <button type="button" className={styles.linkButton} onClick={withdraw} disabled={busy}>
              {busy ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}
        </div>
      )}
      <span className={styles.strings} aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n} />
        ))}
      </span>
      <div className={styles.actions}>
        <Link className={styles.play} to={`/songs/${song.id}/practice`} aria-label={`Practise ${song.title}`}>
          <span className={styles.playIcon} aria-hidden="true">
            ▶
          </span>
          Practise
        </Link>
        <span className={styles.iconButtons}>
          {canShare && (
            <button
              type="button"
              className={`${styles.iconButton} ${styles.shareButton}`}
              aria-label={`Share ${song.title} with everyone`}
              title="Share with everyone"
              aria-expanded={confirming === 'share'}
              onClick={() => setConfirming('share')}
            >
              <ShareIcon />
            </button>
          )}
          {song.canEdit ? (
            <>
              <Link className={styles.iconButton} to={`/songs/${song.id}/edit`} aria-label={`Edit ${song.title}`} title="Edit">
                <PencilIcon />
              </Link>
              <button
                type="button"
                className={`${styles.iconButton} ${styles.danger}`}
                aria-label={`Delete ${song.title}`}
                title="Delete"
                aria-expanded={confirming === 'delete'}
                onClick={() => setConfirming('delete')}
              >
                <BinIcon />
              </button>
            </>
          ) : (
            <Link className={styles.iconButton} to={`/songs/${song.id}`} aria-label={`Notes of ${song.title}`} title="Notes">
              <NoteIcon />
            </Link>
          )}
        </span>
      </div>
      {confirming === 'share' && (
        <div className={`${styles.confirm} ${styles.confirmShare}`} role="alertdialog" aria-label={`Share ${song.title}?`}>
          <p>
            <strong>Share “{song.title}” with everyone?</strong> The admin checks it first. Your own copy stays yours.
          </p>
          <div className={styles.confirmButtons}>
            <button type="button" className="button button-primary" onClick={share} disabled={busy}>
              {busy ? 'Sending…' : 'Send to admin'}
            </button>
            <button type="button" className="button" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirming === 'delete' && (
        <div className={styles.confirm} role="alertdialog" aria-label={`Delete ${song.title}?`}>
          <p>
            <strong>Delete “{song.title}”?</strong> {song.scope === 'global' ? 'It will be removed for everyone.' : 'This cannot be undone.'}
          </p>
          <div className={styles.confirmButtons}>
            <button type="button" className="button button-primary" onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete it'}
            </button>
            <button type="button" className="button" onClick={() => setConfirming(null)} disabled={busy}>
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
    </li>
  )
}

export function LibraryPage() {
  usePageTitle('Songs')
  const [params] = useSearchParams()
  const auth = useAuth()
  const isAdmin = auth.user?.role === 'admin'
  const asked = params.get('list')
  let list: 'global' | 'mine' | 'requests' = 'global'
  if (asked === 'mine') list = 'mine'
  else if (asked === 'requests' && isAdmin) list = 'requests'
  const repository = useSongRepository()
  const signedIn = auth.status === 'signedIn'
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState(0)
  const songs = useSongList(list === 'mine' && signedIn ? 'mine' : 'global', query, version)
  const waiting = useWaitingRequests(isAdmin, version)
  const allDevice = repository.deviceSongs()
  const device = allDevice.filter((song) => song.title.toLowerCase().includes(query.trim().toLowerCase()))
  const one = allDevice.length === 1
  const [moving, setMoving] = useState(false)
  const [moveMessage, setMoveMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function moveToAccount() {
    setMoving(true)
    setMoveMessage(null)
    try {
      const count = await repository.moveDeviceSongs()
      setMoveMessage({ ok: true, text: `Moved ${count} song${count === 1 ? '' : 's'} into My songs. They are safe in your account now.` })
      setVersion((v) => v + 1)
    } catch (error) {
      setMoveMessage({ ok: false, text: error instanceof Error ? error.message : 'The songs could not be moved. Please try again.' })
    } finally {
      setMoving(false)
    }
  }

  const fromHere = { from: list === 'mine' ? '/songs?list=mine' : '/songs' }
  const showMineGate = list === 'mine' && auth.status === 'signedOut'
  const showSongs = list !== 'requests'
  const sessionEnded = list === 'mine' && songs.status === 'error' && songs.code === 401

  let shown: SongSummary[] = []
  if (songs.status === 'ready' && !showMineGate) shown = songs.value
  if (list === 'mine') shown = [...shown, ...device.map(deviceSummary)]

  return (
    <div className="page stack">
      <PageBanner
        kicker="Tonight's set list"
        title="Songs"
        headingId="songs-heading"
        photo={{ src: seated, alt: 'Melantha, smiling, seated in a studio', width: 300, height: 400 }}
      >
        <p>Choose a song and play along. Melantha&apos;s app listens and follows you.</p>
      </PageBanner>

      <nav className={`${styles.tabs} ${isAdmin ? styles.tabs3 : ''}`} aria-label="Song lists">
        <Link to="/songs" className={styles.tab} aria-current={list === 'global' ? 'page' : undefined}>
          <span aria-hidden="true">🌍 </span>Global <span className={styles.tabExtra}>set list</span>
        </Link>
        <Link to="/songs?list=mine" className={styles.tab} aria-current={list === 'mine' ? 'page' : undefined}>
          <span aria-hidden="true">🎸 </span>My songs
        </Link>
        {isAdmin && (
          <Link to="/songs?list=requests" className={styles.tab} aria-current={list === 'requests' ? 'page' : undefined}>
            <span aria-hidden="true">📥 </span>Requests
            {waiting > 0 && (
              <span className={styles.count} aria-label={`, ${waiting} waiting`}>
                {waiting}
              </span>
            )}
          </Link>
        )}
      </nav>

      {list === 'requests' && <ShareRequestList onReviewed={() => setVersion((v) => v + 1)} />}

      {list === 'global' && auth.user?.role === 'admin' && (
        <div className={styles.toolbar}>
          <Link className="button" to="/import?to=global">
            <span aria-hidden="true">＋ </span>Add a global song
          </Link>
        </div>
      )}

      {(showMineGate || sessionEnded) && (
        <section className={`card ${styles.gate}`} aria-labelledby="mine-gate-heading">
          <GuitarPick className={styles.gatePick} />
          <h2 id="mine-gate-heading">{sessionEnded ? 'Please sign in again' : 'Keep your own songs'}</h2>
          <p>Create a free account to save songs, keep them on any phone, and share them with everyone after the admin checks them.</p>
          <div className={styles.gateButtons}>
            <Link className="button button-primary" to="/signup" state={fromHere}>
              Create a free account
            </Link>
            <Link className="button" to="/signin" state={fromHere}>
              Sign in
            </Link>
          </div>
        </section>
      )}

      {list === 'mine' && signedIn && (
        <div className={styles.toolbar}>
          <Link className="button button-primary" to="/import">
            <span aria-hidden="true">＋ </span>Add a song
          </Link>
        </div>
      )}

      {list === 'mine' && signedIn && allDevice.length > 0 && (
        <div className={`notice ${styles.move}`}>
          <p>
            <strong>
              {allDevice.length} song{one ? ' is' : 's are'} saved only on this phone.
            </strong>{' '}
            Move {one ? 'it' : 'them'} into your account to keep {one ? 'it' : 'them'} safe and use {one ? 'it' : 'them'} on any phone.
          </p>
          <button type="button" className="button button-primary" onClick={moveToAccount} disabled={moving}>
            {moving ? 'Moving…' : 'Move to my account'}
          </button>
        </div>
      )}
      {moveMessage && (
        <p role={moveMessage.ok ? 'status' : 'alert'} className={moveMessage.ok ? 'notice' : 'error-box'}>
          {moveMessage.text}
        </p>
      )}

      {showSongs && !(showMineGate && device.length === 0) && (
        <div className={`field ${styles.search}`}>
          <label htmlFor="song-search">Search songs by title or artist</label>
          <input
            id="song-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            placeholder="Type a song name…"
          />
        </div>
      )}

      {showMineGate && device.length > 0 && <h2 className={styles.deviceHeading}>Saved on this phone</h2>}

      {showSongs && songs.status === 'loading' && !showMineGate && <p role="status">Loading your songs…</p>}
      {showSongs && songs.status === 'error' && !sessionEnded && (
        <p role="alert" className="error-box">
          Songs could not be loaded: {songs.message}
        </p>
      )}
      {showSongs && (songs.status === 'ready' || showMineGate) && !(showMineGate && device.length === 0) && (
        <>
          <p role="status" className="muted">
            {shown.length === 0
              ? query.trim()
                ? `No songs match “${query.trim()}”.`
                : list === 'mine'
                  ? 'No songs yet. Tap “Add a song” to paste or upload your first one.'
                  : 'No songs yet.'
              : `${shown.length} song${shown.length === 1 ? '' : 's'}`}
          </p>
          {shown.length > 0 && (
            <ol className={styles.list}>
              {shown.map((song, i) => (
                <SongCard key={song.id} song={song} number={i + 1} onChanged={() => setVersion((v) => v + 1)} />
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

