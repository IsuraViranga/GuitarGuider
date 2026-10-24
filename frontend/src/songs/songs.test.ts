import { describe, expect, it } from 'vitest'
import { STANDARD_TUNING } from '../music/tuning'
import { formatGuitarNumber } from '../music/guitarNumber'
import { parseAsciiTab } from './parsers/asciiTab'
import { parseGuitarNumberText } from './parsers/guitarNumberText'
import type { SongFileParseResult } from './parsers/types'
import { SAMPLE_SONGS } from './sampleSongs'
import { LIBRARY_ERRORS, LIBRARY_SONGS, loadLibrarySongs } from './librarySongs'
import { LocalSongRepository } from './songRepository'
import type { Song } from './types'
import { notesFromPositions, validateSong } from './validation'

const numbersOf = (result: SongFileParseResult) => {
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.value.notes.map((note) => formatGuitarNumber(note.position))
}

const issuesOf = (result: SongFileParseResult) => {
  if (result.ok) throw new Error('expected parse to fail')
  return result.issues
}

describe('sample songs', () => {
  it.each(SAMPLE_SONGS.map((song) => [song.title, song] as const))('%s is valid', (_title, song) => {
    expect(validateSong(song)).toEqual([])
  })

  it('have unique ids', () => {
    expect(new Set(SAMPLE_SONGS.map((s) => s.id)).size).toBe(SAMPLE_SONGS.length)
  })
})

describe('validateSong', () => {
  const base = (): Song => ({
    id: 'x',
    title: 'Test',
    tuningId: 'standard',
    source: 'import',
    notes: notesFromPositions([{ position: { stringNumber: 1, fret: 3 } }], STANDARD_TUNING),
  })

  it('reports a pitch that does not match the position', () => {
    const song = base()
    song.notes[0].midi = 60
    expect(validateSong(song)[0].message).toMatch(/13 plays G4, but the song expects C4/)
  })

  it('reports missing positions, empty songs, unknown tunings and blank titles', () => {
    const song = base()
    song.notes[0].position = null
    expect(validateSong(song)[0].message).toMatch(/no string\/fret/)
    expect(validateSong({ ...base(), notes: [] })[0].message).toMatch(/no notes/)
    expect(validateSong({ ...base(), tuningId: 'nope' })[0].message).toMatch(/Unknown tuning/)
    expect(validateSong({ ...base(), title: '  ' })[0].message).toMatch(/title/)
  })
})

describe('guitar number text format', () => {
  it('reads numbers, headers, comments, commas and measures', () => {
    const result = parseGuitarNumberText(
      ['title: Test Tune', 'difficulty: Beginner', '# a comment', '10, 11 13 |', '| 112 60'].join('\n'),
      STANDARD_TUNING,
    )
    expect(numbersOf(result)).toEqual(['10', '11', '13', '112', '60'])
    if (!result.ok) return
    expect(result.value.title).toBe('Test Tune')
    expect(result.value.difficulty).toBe('beginner')
    expect(result.value.notes.map((n) => n.measure)).toEqual([1, 1, 1, 2, 2])
  })

  it('reads chords written in square brackets', () => {
    const result = parseGuitarNumberText('10 [53 42 30 21 10] 11 [32 21 10]', STANDARD_TUNING)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.notes.map((n) => n.chord?.name ?? formatGuitarNumber(n.position))).toEqual(['10', 'C', '11', 'Am'])
  })

  it('explains bracket mistakes', () => {
    const issues = issuesOf(parseGuitarNumberText('[53 42 30', STANDARD_TUNING))
    expect(issues[0].message).toMatch(/closing/)
    expect(issuesOf(parseGuitarNumberText('[21 23]', STANDARD_TUNING))[0].message).toMatch(/String 2 appears twice/)
  })

  it('omits measures when there are no barlines', () => {
    const result = parseGuitarNumberText('10 11', STANDARD_TUNING)
    expect(result.ok && result.value.notes.every((n) => n.measure === undefined)).toBe(true)
  })

  it('reports invalid numbers with line and column', () => {
    const issues = issuesOf(parseGuitarNumberText('10 11\n13 75 1x', STANDARD_TUNING))
    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatchObject({ line: 2, column: 4 })
    expect(issues[0].message).toMatch(/Strings are numbered 1 to 6/)
    expect(issues[1]).toMatchObject({ line: 2, column: 7 })
  })

  it('rejects files without notes and bad difficulty', () => {
    expect(issuesOf(parseGuitarNumberText('# nothing\n', STANDARD_TUNING))[0].message).toMatch(/No guitar numbers/)
    expect(issuesOf(parseGuitarNumberText('difficulty: expert\n10', STANDARD_TUNING))[0].line).toBe(1)
  })
})

describe('ASCII tab format', () => {
  const tab = (...lines: string[]) => lines.join('\n')

  it('reads notes left to right across strings', () => {
    const result = parseAsciiTab(
      tab(
        'title: Tab Test',
        'e|-----0---3---|',
        'B|---1---------|',
        'G|-------------|',
        'D|-------------|',
        'A|-------------|',
        'E|-0-----------|',
      ),
      STANDARD_TUNING,
    )
    expect(numbersOf(result)).toEqual(['60', '21', '10', '13'])
    expect(result.ok && result.value.title).toBe('Tab Test')
  })

  it('reads two-digit frets, multiple blocks and ignores text lines', () => {
    const result = parseAsciiTab(
      tab(
        'Verse',
        'e|-12-10-|',
        'B|-------|',
        'G|-------|',
        'D|-------|',
        'A|-------|',
        'E|-------|',
        '',
        '1|---|',
        '2|-3-|',
        '3|---|',
        '4|---|',
        '5|---|',
        '6|---|',
      ),
      STANDARD_TUNING,
    )
    expect(numbersOf(result)).toEqual(['112', '110', '23'])
  })

  it('aligns columns from the first "|" even when labels differ in width', () => {
    const result = parseAsciiTab(
      tab('e |--0-|', 'B|-1--|', 'G|----|', 'D|----|', 'A|----|', 'E|----|'),
      STANDARD_TUNING,
    )
    expect(numbersOf(result)).toEqual(['21', '10'])
  })

  it('reads numbers in the same column as a chord', () => {
    const result = parseAsciiTab(
      tab('e|-0---3-|', 'B|-1-----|', 'G|-0-----|', 'D|-2-----|', 'A|-3-----|', 'E|-------|'),
      STANDARD_TUNING,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.notes).toHaveLength(2)
    expect(result.value.notes[0].chord?.name).toBe('C')
    expect(result.value.notes[0].chord?.positions.map(formatGuitarNumber)).toEqual(['53', '42', '30', '21', '10'])
    expect(formatGuitarNumber(result.value.notes[1].position)).toBe('13')
  })

  it('rejects incomplete blocks, wrong labels, techniques and high frets', () => {
    expect(issuesOf(parseAsciiTab(tab('e|-0-|', 'B|---|'), STANDARD_TUNING))[0].message).toMatch(/exactly 6/)

    const wrongLabel = issuesOf(
      parseAsciiTab(tab('e|-0-|', 'G|---|', 'G|---|', 'D|---|', 'A|---|', 'E|---|'), STANDARD_TUNING),
    )
    expect(wrongLabel[0]).toMatchObject({ line: 2 })
    expect(wrongLabel[0].message).toMatch(/should be string 2/)

    const technique = issuesOf(
      parseAsciiTab(tab('e|-5h7-|', 'B|-----|', 'G|-----|', 'D|-----|', 'A|-----|', 'E|-----|'), STANDARD_TUNING),
    )
    expect(technique[0]).toMatchObject({ line: 1, column: 5 })
    expect(technique[0].message).toMatch(/hammer-on/)

    const high = issuesOf(
      parseAsciiTab(tab('e|-25-|', 'B|----|', 'G|----|', 'D|----|', 'A|----|', 'E|----|'), STANDARD_TUNING),
    )
    expect(high[0].message).toMatch(/highest fret/)
  })

  it('flags tab-like lines missing the "|" and empty files', () => {
    expect(issuesOf(parseAsciiTab('e---0---3---', STANDARD_TUNING))[0].message).toMatch(/no "\|"/)
    expect(issuesOf(parseAsciiTab('just some words', STANDARD_TUNING))[0].message).toMatch(/No tab notes/)
  })
})

describe('LocalSongRepository', () => {
  it('lists samples and searches by title, case-insensitively', async () => {
    const repo = new LocalSongRepository()
    expect((await repo.listSongs()).length).toBe(SAMPLE_SONGS.length + LIBRARY_SONGS.length)
    const found = await repo.listSongs('  ODE ')
    expect(found.map((s) => s.title)).toEqual(['Ode to Joy (melody)'])
    expect(await repo.listSongs('zzz')).toEqual([])
  })

  it('saves imported songs to storage and reads them back', async () => {
    const repo = new LocalSongRepository()
    const saved = await repo.saveImportedSong({
      title: 'Mine',
      tuningId: 'standard',
      notes: notesFromPositions([{ position: { stringNumber: 2, fret: 1 } }], STANDARD_TUNING),
    })
    expect(saved.source).toBe('import')
    expect(await new LocalSongRepository().getSong(saved.id)).toEqual(saved)
  })

  it('ignores corrupted storage instead of crashing', async () => {
    localStorage.setItem('guitar-practice:imported-songs:v1', '{not json')
    expect((await new LocalSongRepository().listSongs()).length).toBe(SAMPLE_SONGS.length + LIBRARY_SONGS.length)
  })
})

describe('instructor library', () => {
  it('every library file is valid', () => {
    // If this fails, the message names the file, line and column to fix.
    expect(LIBRARY_ERRORS).toEqual([])
    expect(LIBRARY_SONGS.length).toBeGreaterThan(0)
    for (const song of LIBRARY_SONGS) expect(validateSong(song)).toEqual([])
  })

  it('has Twinkle, twinkle as a song sheet: 42 notes, each with its syllable', () => {
    const song = LIBRARY_SONGS.find((s) => s.id === 'library-twinkle-twinkle')
    expect(song?.title).toBe('Twinkle, twinkle')
    expect(song?.notes).toHaveLength(42)
    expect(song?.notes.slice(0, 7).map((n) => `${n.position?.stringNumber}${n.position?.fret} ${n.lyric}`)).toEqual([
      '23 Twin', '23 kle,', '15 twin', '15 kle,', '17 lit', '17 tle', '15 star,',
    ])
    expect(song?.notes.every((n) => n.lyric)).toBe(true)
  })

  it('loads guitar-number and tab files, including Sinhala titles', () => {
    const { songs, errors } = loadLibrarySongs({
      './library/b-tab.tab': 'e|-0-3-|\nB|-----|\nG|-----|\nD|-----|\nA|-----|\nE|-----|',
      './library/a-song.txt': 'title: මගේ ගීතය\ndescription: Arranged by the instructor\n10 11',
    })
    expect(errors).toEqual([])
    expect(songs.map((s) => [s.id, s.title, s.source])).toEqual([
      ['library-a-song', 'මගේ ගීතය', 'library'],
      ['library-b-tab', 'b tab', 'library'],
    ])
    expect(songs[0].description).toBe('Arranged by the instructor')
    expect(songs[1].notes.map((n) => n.midi)).toEqual([64, 67])
  })

  it('reports a broken file without stopping the others', () => {
    const { songs, errors } = loadLibrarySongs({ './library/ok.txt': '10', './library/bad.txt': '10 75' })
    expect(songs.map((s) => s.id)).toEqual(['library-ok'])
    expect(errors[0].file).toBe('bad.txt')
    expect(errors[0].issues[0]).toMatchObject({ line: 1, column: 4 })
  })

  it('appears first in the song list', async () => {
    const list = await new LocalSongRepository().listSongs()
    expect(list[0].source).toBe('library')
    expect(list[0].title).toBe('G මේජර් පරිමාණය – පුහුණුව')
  })
})
