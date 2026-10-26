import { describe, expect, it } from 'vitest'
import { importSongText } from './importSong'
import { AppSongRepository } from './songRepository'
import { decodeTextFile, normalizeForSearch } from './text'

const SRI_WITH_ZWJ = 'ශ්‍රී' // ශ්‍රී as typed with a zero-width joiner
const SRI_WITHOUT_ZWJ = 'ශ්රී'

describe('Sinhala text', () => {
  it('matches Sinhala words with or without the invisible joiner', () => {
    expect(normalizeForSearch(SRI_WITH_ZWJ)).toBe(normalizeForSearch(SRI_WITHOUT_ZWJ))
  })

  it('imports a song with a Sinhala title and finds it by search', async () => {
    const result = importSongText(`title: ${SRI_WITH_ZWJ} පුහුණුව\n10 11 13`, 'guitar-numbers')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.song.title).toBe(`${SRI_WITH_ZWJ} පුහුණුව`)

    // Found on the phone's copy of the global list (and by the server, see backend tests).
    const repo = new AppSongRepository([{ ...result.song, id: 'sri', source: 'library' }])
    expect(repo.cachedGlobalSongs(SRI_WITHOUT_ZWJ).map((s) => s.title)).toEqual([`${SRI_WITH_ZWJ} පුහුණුව`])
    expect(repo.cachedGlobalSongs('පුහුණුව').map((s) => s.title)).toContain(`${SRI_WITH_ZWJ} පුහුණුව`)
  })

  it('reads UTF-8 files, with or without a byte-order mark', () => {
    const utf8 = new TextEncoder().encode('title: මගේ ගීතය\n10')
    expect(decodeTextFile(utf8.buffer)).toBe('title: මගේ ගීතය\n10')
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])
    expect(decodeTextFile(withBom.buffer)).toBe('title: මගේ ගීතය\n10')
  })

  it('reads UTF-16 files saved by Windows Notepad', () => {
    const text = 'title: මගේ ගීතය\n10'
    const bytes = new Uint8Array(2 + text.length * 2)
    bytes.set([0xff, 0xfe])
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      bytes[2 + i * 2] = code & 0xff
      bytes[3 + i * 2] = code >> 8
    }
    expect(decodeTextFile(bytes.buffer)).toBe(text)
  })

  it('rejects bytes that are not text', () => {
    expect(decodeTextFile(new Uint8Array([0xc3, 0x28, 0xa0, 0xa1]).buffer)).toBeNull()
  })
})
