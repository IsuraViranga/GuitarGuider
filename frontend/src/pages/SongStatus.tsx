import { Link } from 'react-router-dom'
import type { LoadState } from '../songs/useSong'
import type { Song } from '../songs/types'

/** Loading / not-found / error screens shared by pages that show one song. Returns null when ready. */
export function SongStatus({ state }: { state: LoadState<Song | undefined> }) {
  if (state.status === 'loading') {
    return (
      <div className="page">
        <p role="status">Loading song…</p>
      </div>
    )
  }
  if (state.status === 'error' || !state.value) {
    return (
      <div className="page stack">
        <h1>{state.status === 'error' ? 'Song could not be loaded' : 'Song not found'}</h1>
        <p>{state.status === 'error' ? state.message : 'This song does not exist or was removed.'}</p>
        <Link className="button" to="/songs">
          Back to songs
        </Link>
      </div>
    )
  }
  return null
}
