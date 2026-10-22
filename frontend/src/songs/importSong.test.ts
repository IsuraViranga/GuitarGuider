import { describe, expect, it } from 'vitest'
import { checkImportFile, importSongText, MAX_IMPORT_BYTES, titleFromFileName } from './importSong'

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
    const result = importSongText('e|-0-|\nB|-1-|\nG|---|\nD|---|\nA|---|\nE|---|', 'ascii-tab', 'x')
    expect(!result.ok && result.issues[0].message).toMatch(/chord/)
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
