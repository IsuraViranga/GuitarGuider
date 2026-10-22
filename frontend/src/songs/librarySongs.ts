// Built-in songs supplied by the instructor as text files in src/songs/library/.
// Every .txt or .tab file in that folder becomes a song in the library automatically.
// See src/songs/library/README.md.

import { importSongText, looksLikeAsciiTab, titleFromFileName } from './importSong'
import type { Song, SongIssue } from './types'

export type LibraryFileError = { file: string; issues: SongIssue[] }

/** Turns { "./library/name.txt": "file text" } into songs, collecting errors per file. */
export function loadLibrarySongs(files: Record<string, string>): { songs: Song[]; errors: LibraryFileError[] } {
  const songs: Song[] = []
  const errors: LibraryFileError[] = []

  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const fileName = path.split('/').pop() ?? path
    const format = fileName.toLowerCase().endsWith('.tab') || looksLikeAsciiTab(text) ? 'ascii-tab' : 'guitar-numbers'
    // A file without a "title:" line is named after the file.
    const hasTitle = /^\s*title\s*:\s*\S/im.test(text)
    const result = importSongText(text, format, hasTitle ? '' : titleFromFileName(fileName))
    if (result.ok) {
      songs.push({ ...result.song, id: `library-${fileName.replace(/\.[^.]+$/, '')}`, source: 'library' })
    } else {
      errors.push({ file: fileName, issues: result.issues })
    }
  }
  return { songs, errors }
}

const files = import.meta.glob<string>('./library/*.{txt,tab}', { query: '?raw', import: 'default', eager: true })
const loaded = loadLibrarySongs(files)

export const LIBRARY_SONGS: readonly Song[] = loaded.songs
/** Files that could not be loaded. Tests fail if this is not empty; the app skips them. */
export const LIBRARY_ERRORS: readonly LibraryFileError[] = loaded.errors

for (const { file, issues } of LIBRARY_ERRORS) {
  console.error(`Library song "${file}" was skipped:`, issues.map((issue) => issue.message).join(' '))
}
