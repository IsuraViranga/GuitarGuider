import { useEffect, useState } from 'react'
import { useSongRepository, type SongSummary } from './songRepository'
import type { Song } from './types'

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string; code?: number }

const loadError = (error: unknown) =>
  ({
    status: 'error',
    message: error instanceof Error ? error.message : 'Something went wrong.',
    ...(error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? { code: error.status } : {}),
  }) as const

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

/** Waits before asking the server while the user is still typing a search. */
export const SEARCH_DELAY_MS = 300

/**
 * Global songs (shown at once from the copy on the phone, then refreshed from the server) or the
 * user's own songs. Change `version` to load again (e.g. after deleting or moving songs).
 */
export function useSongList(scope: 'global' | 'mine', query: string, version = 0): LoadState<SongSummary[]> {
  const repository = useSongRepository()
  const [result, setResult] = useState<{ key: string; state: LoadState<SongSummary[]> }>()
  const key = `${scope}|${query}|${version}`

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(
      () => {
        repository.listSongs(scope, query).then(
          (songs) => !cancelled && setResult({ key, state: { status: 'ready', value: songs } }),
          (error: unknown) => !cancelled && setResult({ key, state: loadError(error) }),
        )
      },
      query.trim() ? SEARCH_DELAY_MS : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [repository, scope, query, key])

  if (result?.key === key) return result.state
  // Until the server answers: the global list as last seen on this phone.
  if (scope === 'global') return { status: 'ready', value: repository.cachedGlobalSongs(query) }
  return { status: 'loading' }
}
