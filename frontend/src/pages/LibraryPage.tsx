import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { songSourceLabel } from '../songs/describeNote'
import { useSongList } from '../songs/useSong'
import styles from './LibraryPage.module.css'

export function LibraryPage() {
  usePageTitle('Songs')
  const [query, setQuery] = useState('')
  const songs = useSongList(query)

  return (
    <div className="page stack">
      <h1>Songs</h1>

      <div className="field">
        <label htmlFor="song-search">Search songs by title</label>
        <input
          id="song-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
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
          <ul className={styles.list}>
            {songs.value.map((song) => (
              <li key={song.id} className={`card ${styles.item}`}>
                <h2 className={styles.title}>
                  <Link to={`/songs/${song.id}`}>{song.title}</Link>
                </h2>
                {song.description && <p>{song.description}</p>}
                <p className={styles.meta}>
                  {song.difficulty && <span className="badge">{song.difficulty}</span>}
                  <span className="badge">{song.noteCount} notes</span>
                  <span className="badge">{songSourceLabel(song.source)}</span>
                </p>
                <Link
                  className="button button-primary"
                  to={`/songs/${song.id}/practice`}
                  aria-label={`Practise ${song.title}`}
                >
                  Practise
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
