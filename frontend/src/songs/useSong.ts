import { useEffect, useState } from 'react'
import { useSongRepository, type SongSummary } from './songRepository'
import type { Song } from './types'

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string }

const loadError = (error: unknown) =>
  ({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' }) as const

/** Loads one song; value is undefined when no song has that id. */
export function useSong(id: string | undefined): LoadState<Song | undefined> {
  const repository = useSongRepository()
  // Remember which id the result belongs to, so a new id shows "loading" until it arrives.
  const [loaded, setLoaded] = useState<{ id: string | undefined; state: LoadState<Song | undefined> }>()

  useEffect(() => {
    let cancelled = false
    Promise.resolve(id ? repository.getSong(id) : undefined).then(
      (song) => !cancelled && setLoaded({ id, state: { status: 'ready', value: song } }),
      (error: unknown) => !cancelled && setLoaded({ id, state: loadError(error) }),
    )
    return () => {
      cancelled = true
    }
  }, [id, repository])

  return loaded && loaded.id === id ? loaded.state : { status: 'loading' }
}

export function useSongList(query: string): LoadState<SongSummary[]> {
  const repository = useSongRepository()
  const [state, setState] = useState<LoadState<SongSummary[]>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    repository.listSongs(query).then(
      (songs) => !cancelled && setState({ status: 'ready', value: songs }),
      (error: unknown) => !cancelled && setState(loadError(error)),
    )
    return () => {
      cancelled = true
    }
  }, [query, repository])

  return state
}
