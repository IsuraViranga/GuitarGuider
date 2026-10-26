import { describe, expect, it, vi } from 'vitest'
import { STANDARD_TUNING } from '../music/tuning'
import { formatGuitarNumber } from '../music/guitarNumber'
import { parseAsciiTab } from './parsers/asciiTab'
import { parseGuitarNumberText } from './parsers/guitarNumberText'
import type { SongFileParseResult } from './parsers/types'
import { SAMPLE_SONGS } from './sampleSongs'
import { LIBRARY_ERRORS, LIBRARY_SONGS, loadLibrarySongs } from './librarySongs'
import { AppSongRepository, DEVICE_SONGS_KEY, DRAFT_SONG_ID } from './songRepository'
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

describe('AppSongRepository', () => {
  type Route = (body: unknown) => [number, unknown?]
  /** Pretend server; unknown requests fail like a network error (offline). */
  function serve(routes: Record<string, Route>) {
    const calls: { key: string; body: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const key = `${init?.method ?? 'GET'} ${String(input)}`
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ key, body })
      const route = routes[key]
      if (!route) throw new TypeError('Failed to fetch')
      const [status, data] = route(body)
      return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(data), { status })
    })
    return calls
  }
  const apiSong = (id: string, title: string, extra: object = {}) => ({
    id, title, artist: null, description: null, difficulty: null, scope: 'global', canEdit: false, noteCount: 1, chordCount: 0, ...extra,
  })
  const newSong = (title: string) => ({
    title,
    tuningId: 'standard',
    sourceText: '21',
    notes: notesFromPositions([{ position: { stringNumber: 2, fret: 1 } }], STANDARD_TUNING),
  })

  it('offline: shows the built-in songs at once and searches them by title, case-insensitively', async () => {
    serve({})
    const repo = new AppSongRepository()
    expect(repo.cachedGlobalSongs()).toHaveLength(SAMPLE_SONGS.length + LIBRARY_SONGS.length)
    expect((await repo.listSongs('global', '  ODE ')).map((s) => s.title)).toEqual(['Ode to Joy (melody)'])
    expect(await repo.listSongs('global', 'zzz')).toEqual([])
    expect((await repo.getSong('sample-first-frets'))?.title).toBe('First Frets on String 1')
  })

  it("the server's list replaces the copy on the phone, which is then used offline", async () => {
    serve({ 'GET /api/songs?scope=global': () => [200, { songs: [apiSong('new-1', 'Malata Bambareku Se', { artist: 'Melantha' })] }] })
    const repo = new AppSongRepository()
    expect((await repo.listSongs('global')).map((s) => [s.title, s.artist, s.scope])).toEqual([['Malata Bambareku Se', 'Melantha', 'global']])
    serve({})
    expect((await new AppSongRepository().listSongs('global')).map((s) => s.title)).toEqual(['Malata Bambareku Se'])
    expect(new AppSongRepository().cachedGlobalSongs('melantha')).toHaveLength(1)
  })

  it('a deleted song is "not found", and leaves the list on the phone', async () => {
    serve({ 'GET /api/songs/sample-first-frets': () => [404, { detail: 'This song was not found.' }] })
    const repo = new AppSongRepository()
    expect(await repo.getSong('sample-first-frets')).toBeUndefined()
    expect(repo.cachedGlobalSongs().some((s) => s.id === 'sample-first-frets')).toBe(false)
  })

  it('"My songs" needs an account', async () => {
    serve({ 'GET /api/songs?scope=mine': () => [401, { detail: 'Please sign in to see your songs.' }] })
    await expect(new AppSongRepository().listSongs('mine')).rejects.toMatchObject({ status: 401 })
  })

  it('saves a song with only the fields the server accepts, and the chosen place', async () => {
    const calls = serve({ 'POST /api/songs': (body) => [201, { ...apiSong('abc', 'Mine', { scope: 'mine', canEdit: true }), notes: (body as { notes: unknown }).notes, tuningId: 'standard', sourceText: '21' }] })
    const saved = await new AppSongRepository().createSong({ ...newSong('Mine'), artist: '' })
    expect(saved).toMatchObject({ id: 'abc', scope: 'mine', canEdit: true, sourceText: '21' })
    expect(calls[0].body).toEqual({
      title: 'Mine', artist: null, description: null, difficulty: null, tuningId: 'standard', sourceText: '21', notes: newSong('Mine').notes, scope: 'mine',
    })
  })

  it('moves songs saved on this phone into the account, then forgets them here', async () => {
    localStorage.setItem(DEVICE_SONGS_KEY, JSON.stringify([{ ...newSong('Old one'), id: 'import-1', source: 'import' }]))
    const calls = serve({ 'POST /api/songs/move-from-device': () => [201, { songs: [] }] })
    const repo = new AppSongRepository()
    expect(repo.deviceSongs().map((s) => [s.title, s.scope])).toEqual([['Old one', 'device']])
    expect((await repo.getSong('import-1'))?.title).toBe('Old one')
    expect(await repo.moveDeviceSongs()).toBe(1)
    expect((calls[0].body as { songs: { title: string }[] }).songs[0].title).toBe('Old one')
    expect(repo.deviceSongs()).toEqual([])
  })

  it('ignores corrupted storage instead of crashing', () => {
    localStorage.setItem(DEVICE_SONGS_KEY, '{not json')
    localStorage.setItem('mga:global-songs:v1', '{not json')
    const repo = new AppSongRepository()
    expect(repo.deviceSongs()).toEqual([])
    expect(repo.cachedGlobalSongs()).toHaveLength(SAMPLE_SONGS.length + LIBRARY_SONGS.length)
  })

  it('a guest can practise a checked song without saving it', async () => {
    serve({})
    const repo = new AppSongRepository()
    repo.practiseWithoutSaving(newSong('Just trying'))
    expect(await repo.getSong(DRAFT_SONG_ID)).toMatchObject({ title: 'Just trying', scope: 'draft' })
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

  it('appears first in the song list on the phone (before the server answers)', () => {
    expect(new AppSongRepository().cachedGlobalSongs()[0].title).toBe('G මේජර් පරිමාණය – පුහුණුව')
  })
})
