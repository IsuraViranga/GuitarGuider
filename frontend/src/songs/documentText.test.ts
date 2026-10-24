import { existsSync, readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { docxText, textItemsToLines } from './documentText'
import { importSongText } from './importSong'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const run = (text: string) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (...runs: string[]) => `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${runs.join('')}</w:p>`

/** A real .docx (zip) with just the main document part, built like Word writes it. */
function docx(body: string): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`
  return zipSync({ 'word/document.xml': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') })
}

describe('Word (.docx) song sheets', () => {
  it('gives one line per paragraph, joining the pieces Word splits words into', () => {
    const text = docxText(
      docx(
        para(run('Twinkle, twinkle')) +
          para() +
          para(run('23      23    15')) +
          para(run('Twin'), run('  '), run('kle'), run(',  twin')),
      ),
    )
    expect(text.split('\n')).toEqual(['Twinkle, twinkle', '', '23      23    15', 'Twin  kle,  twin'])
  })

  it('keeps tabs as spaces, reads tables row by row, and leaves out deleted (tracked) text', () => {
    const text = docxText(
      docx(
        para(run('10'), '<w:r><w:tab/></w:r>', run('11')) +
          `<w:tbl><w:tr><w:tc>${para(run('13'))}</w:tc><w:tc>${para(run('12'))}</w:tc></w:tr></w:tbl>` +
          para(run('la'), '<w:del><w:r><w:delText>wrong</w:delText></w:r></w:del>', run(' la')),
      ),
    )
    expect(text.split('\n')).toEqual(['10    11', '13   12', 'la la'])
  })

  it('a Word song sheet imports exactly', () => {
    const text = docxText(docx(para(run('My Song')) + para(run('23  23  15')) + para(run('Twin  kle  star'))))
    const result = importSongText(text, 'auto')
    expect(result.ok && result.song.notes.map((n) => n.lyric)).toEqual(['Twin', 'kle', 'star'])
  })
})

describe('PDF text lines', () => {
  const item = (str: string, x: number, y: number, width = str.length * 6, size = 12) => ({
    str,
    transform: [size, 0, 0, size, x, y],
    width,
    height: size,
  })

  it('puts pieces at the same height on one line, left to right, top of the page first', () => {
    const lines = textItemsToLines([item('kle,', 60, 700), item('Twin', 10, 700), item('23', 10, 718), item('23', 60, 718)])
    expect(lines.map((line) => line.split(/\s+/))).toEqual([['23', '23'], ['Twin', 'kle,']])
  })

  it('never joins separate numbers, and keeps digits of one number together', () => {
    const lines = textItemsToLines([item('2', 10, 700, 6), item('3', 16, 700, 6), item('15', 40, 700, 12)])
    expect(lines[0].split(/\s+/)).toEqual(['23', '15'])
  })

  it('marks a bigger gap between lines with an empty line', () => {
    expect(textItemsToLines([item('Title', 10, 760), item('23 15', 10, 700)])).toEqual(['Title', '', '23 15'])
  })
})

// The client's real sheet (sharedSongs/ is not committed; skipped when it is not there).
const REAL_DOCX = '../sharedSongs/Twinkle.docx' // relative to frontend/, where the tests run
describe.skipIf(!existsSync(REAL_DOCX))('the Riversheen school Twinkle sheet (.docx)', () => {
  it('imports with all 42 notes and every syllable in place', () => {
    const result = importSongText(docxText(new Uint8Array(readFileSync(REAL_DOCX))), 'auto')
    if (!result.ok) throw new Error(result.issues[0].message)
    expect(result.song.title).toBe('Twinkle, twinkle')
    expect(result.warnings).toEqual([])
    expect(result.song.notes).toHaveLength(42)
    const numbers = result.song.notes.map((n) => `${n.position!.stringNumber}${n.position!.fret}`)
    expect(numbers.join(' ')).toBe(
      [
        '23 23 15 15 17 17 15',
        '13 13 12 12 10 10 23',
        '15 15 13 13 12 12 10',
        '15 15 13 13 12 12 10',
        '23 23 15 15 17 17 15',
        '13 13 12 12 10 10 23',
      ].join(' '),
    )
    expect(result.song.notes.map((n) => n.lyric).join(' ')).toBe(
      'Twin kle, twin kle, lit tle star, How I won der what you are! Up a bove the world so high, ' +
        'Like a dia mond in the sky, Twin kle, twin kle, lit tle star, How I won der what you are!',
    )
  })
})
