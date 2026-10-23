import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import seated from '../assets/brand/melantha-seated.jpg'
import { PageBanner } from '../components/decor/PageBanner'
import { GuitarPick } from '../components/decor/GuitarPick'
import { songSourceLabel } from '../songs/describeNote'
import type { Difficulty } from '../songs/types'
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

export function LibraryPage() {
  usePageTitle('Songs')
  const [query, setQuery] = useState('')
  const songs = useSongList(query)

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

      <div className={`field ${styles.search}`}>
        <label htmlFor="song-search">Search songs by title</label>
        <input
          id="song-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          placeholder="Type a song name…"
        />
      </div>

      {songs.status === 'loading' && <p role="status">Loading songs…</p>}
      {songs.status === 'error' && (
        <p role="alert" className="error-box">
          Songs could not be loaded: {songs.message}
        </p>
      )}
      {songs.status === 'ready' && (
        <>
          <p role="status" className="muted">
            {songs.value.length === 0
              ? `No songs match “${query.trim()}”.`
              : `${songs.value.length} song${songs.value.length === 1 ? '' : 's'}`}
          </p>
          <ol className={styles.list}>
            {songs.value.map((song, i) => (
              <li key={song.id} className={`card ${styles.item}`}>
                <div className={styles.head}>
                  <span className={styles.cover} aria-hidden="true">
                    <GuitarPick className={styles.coverPick} />
                    <span className={styles.track}>{String(i + 1).padStart(2, '0')}</span>
                  </span>
                  <div className={styles.headText}>
                    <h2 className={styles.title}>
                      <Link to={`/songs/${song.id}`}>{song.title}</Link>
                    </h2>
                    {song.difficulty && <DifficultyPicks difficulty={song.difficulty} />}
                  </div>
                </div>
                {song.description && <p className={styles.description}>{song.description}</p>}
                <p className={styles.meta}>
                  {SINHALA.test(song.title) && <span className={`badge ${styles.sinhala}`}>සිංහල</span>}
                  {song.chordCount > 0 && <span className="badge">{song.chordCount} chords</span>}
                  {song.noteCount > song.chordCount && <span className="badge">{song.noteCount - song.chordCount} notes</span>}
                  <span className="badge">{songSourceLabel(song.source)}</span>
                </p>
                <span className={styles.strings} aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <span key={n} />
                  ))}
                </span>
                <Link
                  className={styles.play}
                  to={`/songs/${song.id}/practice`}
                  aria-label={`Practise ${song.title}`}
                >
                  <span className={styles.playIcon} aria-hidden="true">
                    ▶
                  </span>
                  Practise
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
