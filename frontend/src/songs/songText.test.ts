import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importSongText } from './importSong'
import { LIBRARY_SONGS } from './librarySongs'
import { SAMPLE_SONGS } from './sampleSongs'
import { songToText } from './songText'

describe('song → text → song', () => {
  it.each([...LIBRARY_SONGS, ...SAMPLE_SONGS].map((song) => [song.id, song] as const))('%s comes back with exactly the same notes', (_id, song) => {
    const result = importSongText(songToText(song), 'auto', song.title)
    if (!result.ok) throw new Error(result.issues[0].message)
    expect(result.song.notes).toEqual(song.notes)
  })

  it('writes measures with "|" and one-word lyrics underneath', () => {
    const [twinkle] = LIBRARY_SONGS.filter((s) => s.id === 'library-twinkle-twinkle')
    expect(songToText(twinkle).split('\n').slice(0, 2)).toEqual(['23 23 15 15 17 17 15', 'Twin kle, twin kle, lit tle star,'])
    const [first] = SAMPLE_SONGS.filter((s) => s.id === 'sample-first-frets')
    expect(songToText(first)).toBe('10 11 13 11 | 10 13 11 10')
  })

  it('keeps lines and bars exactly, also when a bar is at the end of a line', () => {
    for (const text of ['10 11\n13 | 11\n10', '10 11 |\n13 11\n10', '10 [53 42 30 21 10]\n13 13']) {
      const song = importSongText(text, 'guitar-numbers', 'T')
      if (!song.ok) throw new Error(song.issues[0].message)
      const again = importSongText(songToText(song.song), 'guitar-numbers', 'T')
      expect(again.ok && again.song.notes).toEqual(song.song.notes)
    }
  })
})

describe('the server\'s built-in songs', () => {
  it('match the songs in the app (run "npm run export:songs" after changing a library file)', () => {
    const seeds = JSON.parse(readFileSync('../backend/app/seed/global_songs.json', 'utf8')) as { id: string; title: string; notes: unknown[] }[]
    const builtIn = [...LIBRARY_SONGS, ...SAMPLE_SONGS]
    expect(seeds.map((s) => s.id)).toEqual(builtIn.map((s) => s.id))
    for (const song of builtIn) {
      const seed = seeds.find((s) => s.id === song.id)!
      expect(seed.title).toBe(song.title)
      expect(seed.notes).toEqual(JSON.parse(JSON.stringify(song.notes)))
    }
  })
})
