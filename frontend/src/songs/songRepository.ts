// Where songs come from. Pages talk to this interface only.
//
// - Global songs (the set list for everyone) and the user's own songs live on the server.
// - The global list and recently opened global songs are also kept on this phone, starting with
//   the songs built into the app, so the list shows at once and practice works while the free
//   server wakes up or the phone is offline.
// - Songs saved on this phone before accounts existed ("device") can be moved into the account.
// - A guest can practise a checked song without saving it ("draft", kept for this browser tab).

import { createContext, useContext } from 'react'
import { apiRequest, ApiError } from '../api/client'
import { LIBRARY_SONGS } from './librarySongs'
import { SAMPLE_SONGS } from './sampleSongs'
import { normalizeForSearch } from './text'
import type { Difficulty, ShareStatus, Song, SongNote, SongScope } from './types'

export type SongSummary = Pick<Song, 'id' | 'title' | 'artist' | 'description' | 'difficulty' | 'shareStatus' | 'shareReason'> & {
  scope: SongScope
  canEdit: boolean
  /** Steps in the song (single notes and chords). */
  noteCount: number
  /** How many of those steps are chords. */
  chordCount: number
}

/** A song as made by the Add a song page, before it has an id. */
export type NewSong = Pick<Song, 'title' | 'artist' | 'description' | 'difficulty' | 'tuningId' | 'notes' | 'sourceText'>

export interface SongRepository {
  /** The global list as last seen (instant, no network). */
  cachedGlobalSongs(query?: string): SongSummary[]
  /** Global songs, or the signed-in user's own songs ("mine" needs an account). */
  listSongs(scope: 'global' | 'mine', query?: string): Promise<SongSummary[]>
  getSong(id: string): Promise<Song | undefined>
  /** Saves a new song as the user's own, or (admin only) in the global set list. */
  createSong(song: NewSong, scope?: 'mine' | 'global'): Promise<Song>
  updateSong(id: string, song: NewSong): Promise<Song>
  deleteSong(id: string): Promise<void>
  /** Songs saved on this phone before accounts existed. */
  deviceSongs(): Song[]
  /** Moves those songs into the signed-in user's account; returns how many. */
  moveDeviceSongs(): Promise<number>
  /** Keeps a checked song for practice without saving it (for guests). Its id is "draft". */
  practiseWithoutSaving(song: NewSong): Song
  /** Asks the admin to put one of your songs in the global set list. */
  requestShare(id: string): Promise<void>
  /** Takes back a request that is still waiting. */
  withdrawShare(id: string): Promise<void>
  // Admin: review requests.
  listShareRequests(state?: 'pending' | 'reviewed'): Promise<ShareRequest[]>
  getShareRequest(id: string): Promise<ShareRequestDetail>
  /** Publishes the song as sent, or `corrected` (edit and approve). */
  approveShareRequest(id: string, corrected?: NewSong): Promise<ShareRequest>
  rejectShareRequest(id: string, reason?: string): Promise<ShareRequest>
}

export type ShareRequest = {
  id: string
  songId: string
  title: string
  artist: string | null
  requesterName: string
  status: ShareStatus
  reason: string | null
  noteCount: number
  chordCount: number
  createdAt: string
  reviewedAt: string | null
  globalSongId: string | null
}

/** A request with the song as it was sent. */
export type ShareRequestDetail = ShareRequest & { song: Song }

export const DRAFT_SONG_ID = 'draft'
const GLOBAL_CACHE_KEY = 'mga:global-songs:v1'
const DRAFT_KEY = 'mga:draft-song:v1'
/** Before accounts, imported songs were kept here (still read so they can be moved). */
export const DEVICE_SONGS_KEY = 'guitar-practice:imported-songs:v1'
/** Global songs kept on the phone for offline practice (the most recently opened). */
const MAX_CACHED_SONGS = 40

type ApiSong = {
  id: string
  title: string
  artist: string | null
  description: string | null
  difficulty: Difficulty | null
  scope: 'global' | 'mine'
  canEdit: boolean
  noteCount: number
  chordCount: number
  shareStatus?: ShareStatus | null
  shareReason?: string | null
  tuningId?: string
  sourceText?: string | null
  notes?: SongNote[]
}

const shareFields = (s: ApiSong) => ({
  ...(s.shareStatus ? { shareStatus: s.shareStatus } : {}),
  ...(s.shareReason ? { shareReason: s.shareReason } : {}),
})

type GlobalCache = { summaries: SongSummary[]; songs: Record<string, Song>; recent: string[] }

function summaryOf(song: Song, scope: SongScope = song.scope ?? 'global'): SongSummary {
  return {
    id: song.id,
    title: song.title,
    ...(song.artist ? { artist: song.artist } : {}),
    ...(song.description ? { description: song.description } : {}),
    ...(song.difficulty ? { difficulty: song.difficulty } : {}),
    scope,
    canEdit: song.canEdit ?? false,
    noteCount: song.notes.length,
    chordCount: song.notes.filter((n) => n.chord).length,
  }
}

function fromApiSummary(s: ApiSong): SongSummary {
  return {
    id: s.id,
    title: s.title,
    ...(s.artist ? { artist: s.artist } : {}),
    ...(s.description ? { description: s.description } : {}),
    ...(s.difficulty ? { difficulty: s.difficulty } : {}),
    scope: s.scope,
    canEdit: s.canEdit,
    noteCount: s.noteCount,
    chordCount: s.chordCount,
    ...shareFields(s),
  }
}

function fromApiSong(s: ApiSong): Song {
  return {
    id: s.id,
    title: s.title,
    ...(s.artist ? { artist: s.artist } : {}),
    ...(s.description ? { description: s.description } : {}),
    ...(s.difficulty ? { difficulty: s.difficulty } : {}),
    tuningId: s.tuningId ?? 'standard',
    scope: s.scope,
    canEdit: s.canEdit,
    ...shareFields(s),
    ...(s.sourceText ? { sourceText: s.sourceText } : {}),
    notes: s.notes ?? [],
  }
}

/** Only the fields the server accepts (it refuses anything else). */
function toApiBody(song: NewSong) {
  return {
    title: song.title,
    artist: song.artist || null,
    description: song.description || null,
    difficulty: song.difficulty ?? null,
    tuningId: song.tuningId,
    sourceText: song.sourceText ?? null,
    notes: song.notes,
  }
}

const matches = (query: string) => {
  const needle = normalizeForSearch(query)
  return (song: { title: string; artist?: string }) => normalizeForSearch(`${song.title} ${song.artist ?? ''}`).includes(needle)
}

/** Network trouble (or the server waking up): use what is on the phone instead. */
const isOffline = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status >= 500

export class AppSongRepository implements SongRepository {
  private readonly builtIn: readonly Song[]
  private readonly storage: Storage | undefined
  private readonly session: Storage | undefined

  constructor(
    builtIn: readonly Song[] = [...LIBRARY_SONGS, ...SAMPLE_SONGS],
    storage: Storage | undefined = globalThis.localStorage,
    session: Storage | undefined = globalThis.sessionStorage,
  ) {
    this.builtIn = builtIn.map((song) => ({ ...song, scope: 'global' as const, canEdit: false }))
    this.storage = storage
    this.session = session
  }

  cachedGlobalSongs(query = ''): SongSummary[] {
    return this.readCache().summaries.filter(matches(query))
  }

  async listSongs(scope: 'global' | 'mine', query = ''): Promise<SongSummary[]> {
    const params = new URLSearchParams({ scope, ...(query.trim() ? { q: query.trim() } : {}) })
    try {
      const { songs } = await apiRequest<{ songs: ApiSong[] }>(`/api/songs?${params}`)
      const summaries = songs.map(fromApiSummary)
      if (scope === 'global' && !query.trim()) this.updateCache((cache) => ({ ...cache, summaries }))
      return summaries
    } catch (error) {
      if (scope === 'global' && (isOffline(error) || (error instanceof ApiError && error.status === 404))) return this.cachedGlobalSongs(query)
      throw error
    }
  }

  async getSong(id: string): Promise<Song | undefined> {
    if (id === DRAFT_SONG_ID) return this.readDraft()
    const device = this.deviceSongs().find((song) => song.id === id)
    if (device) return device
    try {
      const song = fromApiSong(await apiRequest<ApiSong>(`/api/songs/${encodeURIComponent(id)}`))
      if (song.scope === 'global') this.rememberGlobalSong(song)
      return song
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        this.updateCache((cache) => ({ ...cache, summaries: cache.summaries.filter((s) => s.id !== id) }))
        return undefined
      }
      if (isOffline(error)) return this.readCache().songs[id] ?? this.builtIn.find((song) => song.id === id)
      throw error
    }
  }

  async createSong(song: NewSong, scope: 'mine' | 'global' = 'mine'): Promise<Song> {
    const saved = fromApiSong(await apiRequest<ApiSong>('/api/songs', { method: 'POST', body: { ...toApiBody(song), scope } }))
    if (saved.scope === 'global') this.rememberGlobalSong(saved, true)
    return saved
  }

  async updateSong(id: string, song: NewSong): Promise<Song> {
    const saved = fromApiSong(await apiRequest<ApiSong>(`/api/songs/${encodeURIComponent(id)}`, { method: 'PUT', body: toApiBody(song) }))
    if (saved.scope === 'global') this.rememberGlobalSong(saved, true)
    return saved
  }

  async deleteSong(id: string): Promise<void> {
    await apiRequest<void>(`/api/songs/${encodeURIComponent(id)}`, { method: 'DELETE' })
    this.updateCache((cache) => {
      const songs = { ...cache.songs }
      delete songs[id]
      return { summaries: cache.summaries.filter((s) => s.id !== id), songs, recent: cache.recent.filter((r) => r !== id) }
    })
  }

  deviceSongs(): Song[] {
    try {
      const raw = this.storage?.getItem(DEVICE_SONGS_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? (parsed as Song[]).map((song) => ({ ...song, scope: 'device' as const, canEdit: false })) : []
    } catch {
      return []
    }
  }

  async moveDeviceSongs(): Promise<number> {
    const songs = this.deviceSongs()
    if (songs.length === 0) return 0
    await apiRequest('/api/songs/move-from-device', { method: 'POST', body: { songs: songs.map(toApiBody) } })
    try {
      this.storage?.removeItem(DEVICE_SONGS_KEY)
    } catch {
      // Moved, but could not be cleared here: they will simply be offered again.
    }
    return songs.length
  }

  practiseWithoutSaving(song: NewSong): Song {
    const draft: Song = { ...song, id: DRAFT_SONG_ID, scope: 'draft', canEdit: false }
    try {
      this.session?.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      throw new Error('This browser does not allow keeping the song for practice.')
    }
    return draft
  }

  async requestShare(id: string): Promise<void> {
    await apiRequest(`/api/songs/${encodeURIComponent(id)}/share`, { method: 'POST' })
  }

  async withdrawShare(id: string): Promise<void> {
    await apiRequest<void>(`/api/songs/${encodeURIComponent(id)}/share`, { method: 'DELETE' })
  }

  async listShareRequests(state: 'pending' | 'reviewed' = 'pending'): Promise<ShareRequest[]> {
    const { requests } = await apiRequest<{ requests: ShareRequest[] }>(`/api/share-requests?state=${state}`)
    return requests
  }

  async getShareRequest(id: string): Promise<ShareRequestDetail> {
    const detail = await apiRequest<ShareRequest & { song: ApiSong }>(`/api/share-requests/${encodeURIComponent(id)}`)
    const s = detail.song
    const song: Song = {
      id: `request-${detail.id}`,
      title: s.title,
      ...(s.artist ? { artist: s.artist } : {}),
      ...(s.description ? { description: s.description } : {}),
      ...(s.difficulty ? { difficulty: s.difficulty } : {}),
      tuningId: s.tuningId ?? 'standard',
      ...(s.sourceText ? { sourceText: s.sourceText } : {}),
      notes: s.notes ?? [],
      scope: 'draft',
      canEdit: false,
    }
    return { ...detail, song }
  }

  async approveShareRequest(id: string, corrected?: NewSong): Promise<ShareRequest> {
    return apiRequest<ShareRequest>(`/api/share-requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      ...(corrected ? { body: toApiBody(corrected) } : {}),
    })
  }

  async rejectShareRequest(id: string, reason?: string): Promise<ShareRequest> {
    return apiRequest<ShareRequest>(`/api/share-requests/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: { reason: reason?.trim() || null },
    })
  }

  // ---------- kept on the phone ----------

  private readDraft(): Song | undefined {
    try {
      const raw = this.session?.getItem(DRAFT_KEY)
      return raw ? (JSON.parse(raw) as Song) : undefined
    } catch {
      return undefined
    }
  }

  private readCache(): GlobalCache {
    try {
      const raw = this.storage?.getItem(GLOBAL_CACHE_KEY)
      if (raw) {
        const cache = JSON.parse(raw) as GlobalCache
        if (Array.isArray(cache.summaries) && cache.songs && Array.isArray(cache.recent)) return cache
      }
    } catch {
      // Unreadable: start again from the built-in songs.
    }
    return {
      summaries: this.builtIn.map((song) => summaryOf(song)),
      songs: Object.fromEntries(this.builtIn.map((song) => [song.id, song])),
      recent: [],
    }
  }

  private updateCache(change: (cache: GlobalCache) => GlobalCache) {
    try {
      this.storage?.setItem(GLOBAL_CACHE_KEY, JSON.stringify(change(this.readCache())))
    } catch {
      // Storage full or blocked: the app still works, just without the offline copy.
    }
  }

  private rememberGlobalSong(song: Song, updateSummary = false) {
    this.updateCache((cache) => {
      const recent = [song.id, ...cache.recent.filter((id) => id !== song.id)]
      const keep = new Set([...recent.slice(0, MAX_CACHED_SONGS), ...this.builtIn.map((s) => s.id)])
      const songs = Object.fromEntries(Object.entries({ ...cache.songs, [song.id]: song }).filter(([id]) => keep.has(id)))
      const summary = summaryOf(song, 'global')
      const summaries = updateSummary
        ? cache.summaries.some((s) => s.id === song.id)
          ? cache.summaries.map((s) => (s.id === song.id ? summary : s))
          : [...cache.summaries, summary]
        : cache.summaries
      return { summaries, songs, recent: recent.slice(0, MAX_CACHED_SONGS) }
    })
  }
}

export const SongRepositoryContext = createContext<SongRepository>(new AppSongRepository())

export function useSongRepository(): SongRepository {
  return useContext(SongRepositoryContext)
}
