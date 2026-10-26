// Built-in songs supplied by the instructor as text files in src/songs/library/.
// Every .txt or .tab file in that folder becomes a song in the library automatically.
// See src/songs/library/README.md.

import { loadLibrarySongs, type LibraryFileError } from './libraryLoader'
import type { Song } from './types'

export { loadLibrarySongs, type LibraryFileError }

const files = import.meta.glob<string>('./library/*.{txt,tab}', { query: '?raw', import: 'default', eager: true })
const loaded = loadLibrarySongs(files)

export const LIBRARY_SONGS: readonly Song[] = loaded.songs
/** Files that could not be loaded. Tests fail if this is not empty; the app skips them. */
export const LIBRARY_ERRORS: readonly LibraryFileError[] = loaded.errors

for (const { file, issues } of LIBRARY_ERRORS) {
  console.error(`Library song "${file}" was skipped:`, issues.map((issue) => issue.message).join(' '))
}
