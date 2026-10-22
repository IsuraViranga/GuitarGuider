// Where songs come from. The app talks to this interface only, so in Phase 5 the
// local implementation can be swapped for one backed by the FastAPI server.

import { createContext, useContext } from 'react'
import { LIBRARY_SONGS } from './librarySongs'
import { SAMPLE_SONGS } from './sampleSongs'
import { normalizeForSearch } from './text'
import type { Song } from './types'

export type SongSummary = Pick<Song, 'id' | 'title' | 'description' | 'difficulty' | 'source'> & {
  noteCount: number
}

export type NewSong = Omit<Song, 'id' | 'source'>

export interface SongRepository {
  listSongs(query?: string): Promise<SongSummary[]>
  getSong(id: string): Promise<Song | undefined>
  saveImportedSong(song: NewSong): Promise<Song>
}

const IMPORTED_SONGS_KEY = 'guitar-practice:imported-songs:v1'

function toSummary({ id, title, description, difficulty, source, notes }: Song): SongSummary {
  return { id, title, description, difficulty, source, noteCount: notes.length }
}

/**
 * Samples are built in; imported songs are kept in this browser's localStorage until
 * accounts and server storage exist (Phase 5). Storage failures (private mode, quota)
 * are reported to the caller instead of being silently lost.
 */
export class LocalSongRepository implements SongRepository {
  /** Built-in songs: the instructor's library first, then the app's samples */
  private readonly samples: readonly Song[]
  private readonly storage: Storage | undefined

  constructor(samples: readonly Song[] = [...LIBRARY_SONGS, ...SAMPLE_SONGS], storage: Storage | undefined = globalThis.localStorage) {
    this.samples = samples
    this.storage = storage
  }

  async listSongs(query = ''): Promise<SongSummary[]> {
    const needle = normalizeForSearch(query)
    return this.allSongs()
      .filter((song) => normalizeForSearch(song.title).includes(needle))
      .map(toSummary)
  }

  async getSong(id: string): Promise<Song | undefined> {
    return this.allSongs().find((song) => song.id === id)
  }

  async saveImportedSong(song: NewSong): Promise<Song> {
    if (!this.storage) throw new Error('This browser does not allow saving songs.')
    const saved: Song = { ...song, id: `import-${crypto.randomUUID()}`, source: 'import' }
    const imported = [...this.importedSongs(), saved]
    try {
      this.storage.setItem(IMPORTED_SONGS_KEY, JSON.stringify(imported))
    } catch {
      throw new Error('The song could not be saved. Browser storage may be full or disabled.')
    }
    return saved
  }

  private allSongs(): Song[] {
    return [...this.samples, ...this.importedSongs()]
  }

  private importedSongs(): Song[] {
    try {
      const raw = this.storage?.getItem(IMPORTED_SONGS_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? (parsed as Song[]) : []
    } catch {
      return []
    }
  }
}

export const SongRepositoryContext = createContext<SongRepository>(new LocalSongRepository())

export function useSongRepository(): SongRepository {
  return useContext(SongRepositoryContext)
}
