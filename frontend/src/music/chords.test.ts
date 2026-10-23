import { describe, expect, it } from 'vitest'
import { chordShape, formatChordNumbers, identifyChord, isChordName, parseChordNumbers } from './chords'

const numbers = (name: string) => {
  const result = chordShape(name)
  if (!result.ok) throw new Error(result.error)
  return formatChordNumbers(result.value.positions)
}

describe('chord names → instructor numbers', () => {
  it.each([
    ['C', '[53 42 30 21 10]'],
    ['G', '[63 52 40 30 20 13]'],
    ['D', '[40 32 23 12]'],
    ['Am', '[50 42 32 21 10]'],
    ['Em', '[60 52 42 30 20 10]'],
    ['E7', '[60 52 40 31 20 10]'],
    ['Dm', '[40 32 23 11]'],
    ['F', '[61 53 43 32 21 11]'],
  ])('%s (open shape) is %s', (name, expected) => {
    expect(numbers(name)).toBe(expected)
  })

  it.each([
    ['Bb', '[51 43 33 23 11]'], // A shape, 1st fret
    ['F#m', '[62 54 44 32 22 12]'], // E shape, 2nd fret
    ['Bm', '[52 44 34 23 12]'], // A shape, 2nd fret
    ['C#m', '[54 46 36 25 14]'], // A shape, 4th fret
    ['Abm', '[64 56 46 34 24 14]'], // E shape, 4th fret
  ])('%s (barre shape) is %s', (name, expected) => {
    expect(numbers(name)).toBe(expected)
  })

  it('treats flats and sharps alike', () => {
    expect(numbers('A#')).toBe(numbers('Bb'))
    expect(numbers('Db')).toBe(numbers('C#'))
  })

  it('puts the bass note of a slash chord on a lower string', () => {
    expect(numbers('C/G')).toBe('[63 53 42 30 21 10]')
    expect(numbers('D/F#')).toBe('[62 40 32 23 12]')
  })

  it('simplifies rich chords and says so', () => {
    const result = chordShape('C9')
    expect(result.ok && result.value.simplifiedFrom).toBe('C9 is played as C7')
    expect(numbers('C9')).toBe(numbers('C7'))
  })

  it('rejects things that are not chords', () => {
    expect(chordShape('Hello').ok).toBe(false)
    expect(chordShape('H7').ok).toBe(false)
  })

  it('recognises chord names in chart text', () => {
    for (const name of ['C', 'Am', 'F#m7', 'Bbmaj7', 'Gsus4', 'C/G', 'Dsus', 'E5', 'Bm7b5', 'Cadd9']) expect(isChordName(name), name).toBe(true)
    for (const word of ['Am I', 'Chorus', 'Intro:', 'a', 'Bad', 'Each', 'Go']) expect(isChordName(word), word).toBe(false)
  })
})

describe('chord numbers', () => {
  it('parses bracketed numbers, thickest string first', () => {
    const result = parseChordNumbers('[10 21 30 42 53]')
    expect(result.ok && formatChordNumbers(result.value)).toBe('[53 42 30 21 10]')
  })

  it('rejects two notes on one string and single notes', () => {
    expect(parseChordNumbers('[21 23]')).toMatchObject({ ok: false, error: expect.stringMatching(/String 2 appears twice/) })
    expect(parseChordNumbers('[21]')).toMatchObject({ ok: false, error: expect.stringMatching(/only one note/) })
    expect(parseChordNumbers('[21 7x]').ok).toBe(false)
  })

  it('names common chords from their numbers', () => {
    const name = (text: string) => {
      const parsed = parseChordNumbers(text)
      return parsed.ok ? identifyChord(parsed.value) : 'invalid'
    }
    expect(name('[53 42 30 21 10]')).toBe('C')
    expect(name('[50 42 32 21 10]')).toBe('Am')
    expect(name('[63 53 42 30 21 10]')).toBe('C/G')
    expect(name('[32 21 10]')).toBe('Am') // A C E: the owner's own example
    expect(name('[33 21 10]')).toBeNull() // A# C E is not a common chord
  })
})
