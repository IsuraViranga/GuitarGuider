// Writes the built-in songs (instructor's library + the app's samples) for the server's global set
// list, converted by exactly the same code the app uses.
//
//   npm run export:songs
//
// Run it after adding or changing a file in src/songs/library/, then commit
// backend/app/seed/global_songs.json. On the next deploy the server adds songs it has never added
// (it never re-adds a song the admin deleted, and never overwrites the admin's changes).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadLibrarySongs } from '../src/songs/libraryLoader'
import { SAMPLE_SONGS } from '../src/songs/sampleSongs'
import { songToText } from '../src/songs/songText'

const LIBRARY = 'src/songs/library'
const OUT = '../backend/app/seed/global_songs.json'

const files: Record<string, string> = {}
for (const name of readdirSync(LIBRARY).filter((n) => /\.(txt|tab)$/.test(n))) {
  files[`./library/${name}`] = readFileSync(join(LIBRARY, name), 'utf8')
}
const { songs: library, errors } = loadLibrarySongs(files)
if (errors.length > 0) {
  console.error('Library files with problems:', JSON.stringify(errors, null, 2))
  process.exit(1)
}

const sourceTextFor = (id: string) => {
  const file = Object.entries(files).find(([path]) => `library-${path.split('/').pop()!.replace(/\.[^.]+$/, '')}` === id)
  return file?.[1]
}

const seeds = [...library, ...SAMPLE_SONGS].map((song) => ({
  id: song.id,
  title: song.title,
  ...(song.description ? { description: song.description } : {}),
  ...(song.difficulty ? { difficulty: song.difficulty } : {}),
  tuningId: song.tuningId,
  sourceText: sourceTextFor(song.id) ?? songToText(song),
  notes: song.notes,
}))

writeFileSync(OUT, `${JSON.stringify(seeds, null, 2)}\n`)
console.log(`Wrote ${seeds.length} built-in songs to ${OUT}`)
