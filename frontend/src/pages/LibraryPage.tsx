import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import seated from '../assets/brand/melantha-seated.jpg'
import { useAuth } from '../auth/authContext'
import { PageBanner } from '../components/decor/PageBanner'
import { GuitarPick } from '../components/decor/GuitarPick'
import { scopeLabel } from '../songs/describeNote'
import { useSongRepository, type SongSummary } from '../songs/songRepository'
import type { Difficulty, Song } from '../songs/types'
import { useSongList } from '../songs/useSong'
import styles from './LibraryPage.module.css'

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

/** One song in the set list: numbered cover, title, artist, badges and a Practise button. */
function SongCard({ song, number }: { song: SongSummary; number: number }) {
  const where = scopeLabel(song.scope)
  return (
    <li className={`card ${styles.item}`} data-scope={song.scope}>
      <div className={styles.head}>
        <span className={styles.cover} aria-hidden="true">
          <GuitarPick className={styles.coverPick} />
          <span className={styles.track}>{String(number).padStart(2, '0')}</span>
        </span>
        <div className={styles.headText}>
          <h2 className={styles.title}>
            <Link to={`/songs/${song.id}`}>{song.title}</Link>
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
      <span className={styles.strings} aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n} />
        ))}
      </span>
      <Link className={styles.play} to={`/songs/${song.id}/practice`} aria-label={`Practise ${song.title}`}>
        <span className={styles.playIcon} aria-hidden="true">
          ▶
        </span>
        Practise
      </Link>
    </li>
  )
}

export function LibraryPage() {
  usePageTitle('Songs')
  const [params] = useSearchParams()
  const list: 'global' | 'mine' = params.get('list') === 'mine' ? 'mine' : 'global'
  const auth = useAuth()
  const repository = useSongRepository()
  const signedIn = auth.status === 'signedIn'
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState(0)
  const songs = useSongList(list === 'mine' && !signedIn ? 'global' : list, query, version)
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

      <nav className={styles.tabs} aria-label="Song lists">
        <Link to="/songs" className={styles.tab} aria-current={list === 'global' ? 'page' : undefined}>
          <span aria-hidden="true">🌍 </span>Global set list
        </Link>
        <Link to="/songs?list=mine" className={styles.tab} aria-current={list === 'mine' ? 'page' : undefined}>
          <span aria-hidden="true">🎸 </span>My songs
        </Link>
      </nav>

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

      {!(showMineGate && device.length === 0) && (
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

      {songs.status === 'loading' && !showMineGate && <p role="status">Loading your songs…</p>}
      {songs.status === 'error' && !sessionEnded && (
        <p role="alert" className="error-box">
          Songs could not be loaded: {songs.message}
        </p>
      )}
      {(songs.status === 'ready' || showMineGate) && !(showMineGate && device.length === 0) && (
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
                <SongCard key={song.id} song={song} number={i + 1} />
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

