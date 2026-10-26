import { describe, expect, it } from 'vitest'
import { importSongText } from './importSong'

/** The line number of every step, e.g. [1, 1, 2]. */
function linesOf(text: string) {
  const result = importSongText(text, 'auto', 'Test')
  if (!result.ok) throw new Error(result.issues[0].message)
  return result.song.notes.map((n) => n.line)
}

describe('the sheet\'s lines are kept', () => {
  it("instructor's numbers: one line per text line, blank and comment lines leave no gap", () => {
    expect(linesOf('10 11 13\n\n# chorus\n23 21\n10')).toEqual([1, 1, 1, 2, 2, 3])
  })

  it('a song written on one line has no line numbers (exactly as before)', () => {
    expect(linesOf('10 11 | 13 11')).toEqual([undefined, undefined, undefined, undefined])
  })

  it('lines and "|" bars are separate: bars still make measures', () => {
    const result = importSongText('10 11 | 13\n23 21', 'auto', 'T')
    expect(result.ok && result.song.notes.map((n) => [n.line, n.measure])).toEqual([
      [1, 1], [1, 1], [1, 2], [2, 2], [2, 2],
    ])
  })

  it('song sheets: each numbers line (with its words) is a line', () => {
    expect(linesOf('Twinkle\n23 23 15\nTwin kle, twin\n\n13 13\nHow I')).toEqual([1, 1, 1, 2, 2])
  })

  it('chord charts: each chord line is a line', () => {
    expect(linesOf('C        G\nfirst words\nAm       F\nsecond words')).toEqual([1, 1, 2, 2])
  })

  it('tab: each block of six lines is a line', () => {
    const block = (a: string) => [`e|-${a}-|`, 'B|---|', 'G|---|', 'D|---|', 'A|---|', 'E|---|'].join('\n')
    expect(linesOf(`${block('0')}\n\n${block('3')}`)).toEqual([1, 2])
  })

  it('the notes themselves are not changed by line numbers', () => {
    const oneLine = importSongText('10 11 13 23', 'guitar-numbers', 'T')
    const twoLines = importSongText('10 11\n13 23', 'guitar-numbers', 'T')
    const strip = (r: typeof oneLine) => (r.ok ? r.song.notes.map(({ line: _l, ...n }) => n) : [])
    expect(strip(twoLines)).toEqual(strip(oneLine))
  })
})
