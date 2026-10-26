import { describe, expect, it } from 'vitest'
import { STANDARD_TUNING } from '../music/tuning'
import { detectFormat, importSongText } from './importSong'
import { parseSongSheet } from './parsers/songSheet'
import { damagedSinhalaWords } from './text'

/** The Riversheen school sheet exactly as the text comes out of the PDF (header above the title). */
const TWINKLE_FROM_PDF = [
  ' ',
  ' ',
  'Riversheen school of ',
  'Music ',
  ' ',
  'Twinkle, twinkle ',
  ' ',
  '23      23    15     15    17   17   15 ',
  'Twin  kle,  twin  kle,  lit    tle   star, ',
  ' ',
  '13      13    12      12    10       10    23 ',
  'How   I      won   der    what  you   are! ',
  ' ',
  '15     15   13      13    12        12   10 ',
  'Up      a    bove  the   world   so   high, ',
  ' ',
  '15     15   13      13       12    12    10 ',
  'Like  a      dia    mond   in    the   sky, ',
  ' ',
  '23      23    15     15    17   17   15 ',
  'Twin  kle,  twin  kle,  lit    tle   star, ',
  ' ',
  '13      13    12      12    10       10    23 ',
  'How   I      won   der    what  you   are! ',
].join('\n')

const parse = (text: string) => parseSongSheet(text, STANDARD_TUNING)
const numbersOf = (notes: { position: { stringNumber: number; fret: number } }[]) =>
  notes.map((n) => `${n.position.stringNumber}${n.position.fret}`).join(' ')

describe('song sheets (numbers with words underneath)', () => {
  it('reads the Twinkle sheet exactly: every number, every syllable, the title', () => {
    expect(detectFormat(TWINKLE_FROM_PDF)).toBe('song-sheet')
    const result = parse(TWINKLE_FROM_PDF)
    if (!result.ok) throw new Error(result.issues[0].message)
    const { notes, title, warnings } = result.value
    expect(title).toBe('Twinkle, twinkle')
    expect(warnings).toBeUndefined()
    expect(notes).toHaveLength(42)
    expect(numbersOf(notes.slice(0, 7))).toBe('23 23 15 15 17 17 15')
    expect(notes.slice(0, 7).map((n) => n.lyric)).toEqual(['Twin', 'kle,', 'twin', 'kle,', 'lit', 'tle', 'star,'])
    expect(numbersOf(notes.slice(7, 14))).toBe('13 13 12 12 10 10 23')
    expect(notes.slice(7, 14).map((n) => n.lyric)).toEqual(['How', 'I', 'won', 'der', 'what', 'you', 'are!'])
    expect(notes.slice(14, 21).map((n) => n.lyric)).toEqual(['Up', 'a', 'bove', 'the', 'world', 'so', 'high,'])
    expect(notes[41]).toMatchObject({ lyric: 'are!', position: { stringNumber: 2, fret: 3 } })
    // Each sheet line is a measure, so the timeline groups notes like the sheet.
    expect(notes.map((n) => n.measure)).toEqual(Array.from({ length: 42 }, (_, i) => Math.floor(i / 7) + 1))
  })

  it('imports as a song with the words on each note', () => {
    const result = importSongText(TWINKLE_FROM_PDF, 'auto')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.song.title).toBe('Twinkle, twinkle')
      expect(result.song.notes[0]).toMatchObject({ midi: 64 - 5 + 3, lyric: 'Twin' })
      expect(result.warnings).toEqual([])
    }
  })

  it('works with Sinhala words and chords in brackets', () => {
    const result = parse('මගේ ගීතය\n10 [53 42 30 21 10] 13\nමල් පිපී ඇත')
    if (!result.ok) throw new Error(result.issues[0].message)
    expect(result.value.title).toBe('මගේ ගීතය')
    expect(result.value.notes.map((n) => n.lyric)).toEqual(['මල්', 'පිපී', 'ඇත'])
    expect(result.value.notes[1].chord?.name).toBe('C')
  })

  it('splits "twin-kle" style syllables when that makes the words match', () => {
    const result = parse('23 23 15\nTwin-kle twin')
    expect(result.ok && result.value.notes.map((n) => n.lyric)).toEqual(['Twin', 'kle', 'twin'])
  })

  it('never guesses: a line with the wrong number of words is kept whole, with a warning naming the line', () => {
    const result = parse('Song\n23 23 15\nTwin kle')
    if (!result.ok) throw new Error('not parsed')
    expect(result.value.notes.map((n) => n.lyric)).toEqual(['Twin kle', undefined, undefined])
    expect(result.value.warnings).toEqual([expect.objectContaining({ line: 3, message: expect.stringContaining('3 numbers but 2 words') })])
  })

  it('reports a mistyped number instead of losing it as a word', () => {
    const result = parse('Song\n23 23 15\nTwin kle twin\n13 2O 12')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]).toMatchObject({ line: 4, message: expect.stringContaining('"2O"') })
  })

  it('reports impossible numbers with the line where they are', () => {
    const result = parse('Song\n23 75 15\nTwin kle twin')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]).toMatchObject({ line: 2 })
  })

  it('numbers lines without words still work, and labels like "Chorus" are not played', () => {
    const result = parse('title: Mine\n10 11\nChorus:\n\n13 13\nla la')
    if (!result.ok) throw new Error('not parsed')
    expect(numbersOf(result.value.notes)).toBe('10 11 13 13')
    // "Chorus:" is directly under the first numbers line, so it is taken as its words: 2 numbers, 1 word → warning.
    expect(result.value.warnings).toHaveLength(1)
    expect(result.value.notes.slice(2).map((n) => n.lyric)).toEqual(['la', 'la'])
  })
})

describe('Sinhala words damaged by a PDF', () => {
  // The exact text pdf.js reads from the Riversheen "නිල් අහස් තලේ" PDF: its font stores some
  // letters in a broken way (other PDF readers give the same symbols).
  const FROM_PDF = [
    'Riversheen school of Music',
    '22 23 10 22 23 22 20',
    '!" අ හස් ත ෙ" අ ෙ*',
    '22 23 10 12 14',
    'නෑ ව ළා 0 1',
    '12 14 15 12 10 22 20',
    'ලස් ස න3 4 රා හ ෙඳ්',
    '10 20 22 20 32',
    '7ස් 8 9 : ලා',
  ].join('\n')

  it('finds the damaged words and says so for each line, while the notes stay exact', () => {
    expect(damagedSinhalaWords('!" අ හස් ත ෙ" අ ෙ*')).toEqual(['!"', 'ෙ"', 'ෙ*'])
    expect(damagedSinhalaWords('නෑ ව ළා 0 1')).toEqual(['0', '1'])
    expect(damagedSinhalaWords('ලස් ස න3 4 රා හ ෙඳ්')).toEqual(['න3', '4', 'ෙඳ්'])
    expect(damagedSinhalaWords('7ස් 8 9 : ලා')).toEqual(['7ස්', '8', '9', ':'])
    const result = parseSongSheet(FROM_PDF, STANDARD_TUNING)
    if (!result.ok) throw new Error('not parsed')
    expect(numbersOf(result.value.notes)).toBe('22 23 10 22 23 22 20 22 23 10 12 14 12 14 15 12 10 22 20 10 20 22 20 32')
    expect(result.value.warnings?.map((w) => w.line)).toEqual([3, 5, 7, 9])
    expect(result.value.warnings?.[0].message).toContain('Some Sinhala words look damaged: !"  ·  ෙ"  ·  ෙ*.')
  })

  it('correct Sinhala lyrics are never flagged (also with normal punctuation)', () => {
    for (const line of ['නිල් අ හස් ත ලේ අ ගේ', 'නෑ ව ළා කු ළු', 'ලස් ස නයි පු රා හ දේ', 'රැස් වි හි දි ලා', 'මල් පිපී ඇත, ඔබ!', 'ශ්‍රී ලංකා මාතා', 'Twin kle, 2 twin']) {
      expect(damagedSinhalaWords(line)).toEqual([])
    }
  })
})
