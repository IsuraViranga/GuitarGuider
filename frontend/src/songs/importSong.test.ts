import { describe, expect, it } from 'vitest'
import { checkImportFile, detectFormat, importSongText, MAX_IMPORT_BYTES, titleFromFileName } from './importSong'

describe('importSongText', () => {
  it('builds a song with pitches derived from positions', () => {
    const result = importSongText('title: Mine\n10 21', 'guitar-numbers')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.song.title).toBe('Mine')
    expect(result.song.notes.map((n) => n.midi)).toEqual([64, 60])
  })

  it('prefers the title typed by the user over the file header', () => {
    const result = importSongText('title: From File\n10', 'guitar-numbers', ' Typed ')
    expect(result.ok && result.song.title).toBe('Typed')
  })

  it('requires a title', () => {
    const result = importSongText('10 11', 'guitar-numbers')
    expect(!result.ok && result.issues[0].message).toMatch(/title/)
  })

  it('passes parser errors through', () => {
    const result = importSongText('e|-5h7-|\nB|-----|\nG|-----|\nD|-----|\nA|-----|\nE|-----|', 'ascii-tab', 'x')
    expect(!result.ok && result.issues[0].message).toMatch(/hammer-on/)
  })

  it('rejects oversized text', () => {
    const result = importSongText('10 '.repeat(MAX_IMPORT_BYTES), 'guitar-numbers', 'Big')
    expect(!result.ok && result.issues[0].message).toMatch(/larger than/)
  })
})

describe('checkImportFile', () => {
  it('accepts small text files only', () => {
    expect(checkImportFile({ name: 'song.txt', size: 100, type: 'text/plain' })).toBeNull()
    expect(checkImportFile({ name: 'song.tab', size: 100, type: '' })).toBeNull()
    expect(checkImportFile({ name: 'song.mp3', size: 100, type: 'audio/mpeg' })).toMatch(/\.txt/)
    expect(checkImportFile({ name: 'song.txt', size: 100, type: 'application/octet-stream' })).toMatch(/plain-text/)
    expect(checkImportFile({ name: 'song.txt', size: MAX_IMPORT_BYTES + 1, type: 'text/plain' })).toMatch(/larger/)
  })
})

it('derives a title from a file name', () => {
  expect(titleFromFileName('Morning_Steps-v2.txt')).toBe('Morning Steps v2')
})

describe('automatic format detection', () => {
  it('recognises each format without the user choosing', () => {
    expect(detectFormat('title: x\n10 11 | [53 42 30 21 10]')).toBe('guitar-numbers')
    expect(detectFormat('e|---0---|\nB|---1---|\nG|-------|\nD|-------|\nA|-------|\nE|-------|')).toBe('ascii-tab')
    expect(detectFormat('C     G\nSome words here')).toBe('chord-chart')
    expect(detectFormat('[C]Some [G]words')).toBe('chord-chart')
  })
})

describe('chord charts', () => {
  const chart = [
    'title: මලට බඹරෙකු සේ (practice chart)',
    '',
    'Intro: C  G  Am  F  x2',
    '',
    '[Verse 1]',
    'C              G',
    'මලට බඹරෙකු සේ',
    'Am             F/C',
    'සිතට ඔබ එනවා',
    '',
    'Chorus:',
    'Dm  G7  C',
  ].join('\n')

  it('turns chords over Sinhala lyrics into chord steps with the words kept', () => {
    const result = importSongText(chart, 'auto')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const steps = result.song.notes
    expect(steps.map((s) => s.chord?.name)).toEqual(['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F/C', 'Dm', 'G7', 'C'])
    // Sinhala does not line up letter by letter, so chords are placed proportionally, words kept whole.
    expect(steps[4].lyric).toBe('මලට බඹරෙකු')
    expect(steps[5].lyric).toBe('සේ')
    expect(steps[6].lyric).toBe('සිතට ඔබ')
    expect(steps[7].lyric).toBe('එනවා')
    expect(steps[0].lyric).toBeUndefined()
    expect(result.song.title).toBe('මලට බඹරෙකු සේ (practice chart)')
  })

  it('never cuts a word when a chord sits above its middle', () => {
    const result = importSongText('C        G\nfirst words here', 'auto', 'x')
    expect(result.ok && result.song.notes.map((n) => n.lyric)).toEqual(['first', 'words here'])
  })

  it('reads ChordPro and Ultimate-Guitar style markup', () => {
    const chordPro = importSongText('{title: Test}\n[C]Malata [G]bambareku se', 'auto')
    expect(chordPro.ok && chordPro.song.notes.map((n) => [n.chord?.name, n.lyric])).toEqual([['C', 'Malata'], ['G', 'bambareku se']])
    const ug = importSongText('[ch]Am[/ch]   [ch]E7[/ch]\nwords and more', 'auto', 'UG')
    expect(ug.ok && ug.song.notes.map((n) => n.chord?.name)).toEqual(['Am', 'E7'])
  })

  it('marks simplified chords and explains unknown ones', () => {
    const simplified = importSongText('C9  G', 'auto', 'x')
    expect(simplified.ok && simplified.song.notes[0].chord?.simplifiedFrom).toBe('C9 is played as C7')
    const unknown = importSongText('C  G\nwords\nC  Hm', 'auto', 'x')
    // "Hm" is not a chord, so that line is treated as words, not chords: no error, just skipped.
    expect(unknown.ok && unknown.song.notes.map((n) => n.chord?.name)).toEqual(['C', 'G'])
  })

  it('explains what to paste when there are no chords', () => {
    const result = importSongText('Just some words\nand more words', 'auto', 'x')
    expect(!result.ok && result.issues[0].message).toMatch(/No chords were found/)
  })
})

describe('chord charts as copied from song websites (song.lk layout)', () => {
  // Same layout as the site; placeholder words.
  const page = [
    '[Intro/Inter]',
    '-----------------------',
    '| D | - | - | - |',
    '| G | - | - | - |',
    '| A | D | - | - |',
    '',
    '[Chorus]',
    '-----------------------',
    'D',
    'First line of words',
    '',
    '[Verse 1]',
    '-----------------------',
    'D              G',
    '',
    'Second line of the words',
  ].join('\n')

  it('reads bar-style intros, separators, labels and a blank line before the words', () => {
    const result = importSongText(page, 'auto', 'Website chart')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.song.notes.map((n) => n.chord?.name)).toEqual(['D', 'G', 'A', 'D', 'D', 'D', 'G'])
    expect(result.song.notes[4].lyric).toBe('First line of words')
    expect(result.song.notes[5].lyric).toBe('Second line of')
    expect(result.song.notes[6].lyric).toBe('the words')
    // Labels and separators are never taken as words.
    expect(result.song.notes.some((n) => n.lyric?.includes('Verse') || n.lyric?.includes('---'))).toBe(false)
  })
})
