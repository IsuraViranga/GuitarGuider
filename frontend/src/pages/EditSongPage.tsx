import { Link, useParams } from 'react-router-dom'
import { useSong } from '../songs/useSong'
import { ImportPage } from './ImportPage'
import { SongStatus } from './SongStatus'

/** Changing a song: the Add a song page, filled in with the song's text. Owner (or admin for global songs) only. */
export function EditSongPage() {
  const { songId } = useParams()
  const state = useSong(songId)
  const song = state.status === 'ready' ? state.value : undefined
  if (!song) return <SongStatus state={state} />
  if (!song.canEdit) {
    return (
      <div className="page stack">
        <h1>{song.title}</h1>
        <p className="error-box" role="alert">
          {song.scope === 'global' ? 'Only the admin can change songs in the global set list.' : 'You can only change your own songs.'}{' '}
          <Link to={`/songs/${song.id}`}>Back to the song</Link>
        </p>
      </div>
    )
  }
  return <ImportPage key={song.id} editSong={song} />
}
