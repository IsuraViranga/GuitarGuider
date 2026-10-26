// Turns the instructor's library files into songs. Pure (no Vite features), so scripts can use it too.
// The app loads the files with librarySongs.ts.

import { detectFormat, importSongText, looksLikeAsciiTab, titleFromFileName } from './importSong'
import type { Song, SongIssue } from './types'

export type LibraryFileError = { file: string; issues: SongIssue[] }

/** Turns { "./library/name.txt": "file text" } into songs, collecting errors per file. */
export function loadLibrarySongs(files: Record<string, string>): { songs: Song[]; errors: LibraryFileError[] } {
  const songs: Song[] = []
  const errors: LibraryFileError[] = []

  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const fileName = path.split('/').pop() ?? path
    // .tab files are tab; anything else is recognised like pasted text (numbers, song sheet with words, …).
    const format = fileName.toLowerCase().endsWith('.tab') || looksLikeAsciiTab(text) ? 'ascii-tab' : detectFormat(text)
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
