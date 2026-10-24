import { describe, expect, it } from 'vitest'
import mapping from '../../../fixtures/guitar-mapping.json'
import { positionToMidi, positionsForMidi, validatePosition, samePitchPositions } from './fretboard'
import { describePosition, formatGuitarNumber, parseGuitarNumber } from './guitarNumber'
import { centsBetween, frequencyToMidi, midiToFrequency, midiToNoteName } from './pitch'
import { STANDARD_TUNING, STRING_NUMBERS, type Tuning } from './tuning'

describe('pitch', () => {
  it('converts MIDI to frequency and back', () => {
    expect(midiToFrequency(69)).toBe(440)
    expect(midiToFrequency(57)).toBeCloseTo(220, 6)
    expect(frequencyToMidi(440)).toBe(69)
    expect(frequencyToMidi(82.4069)).toBeCloseTo(40, 3)
  })

  it('gives fractional MIDI for slightly out-of-tune input', () => {
    // 445 Hz is about 20 cents sharp of A4
    expect(centsBetween(69, frequencyToMidi(445))).toBeCloseTo(19.56, 1)
  })

  it('rejects non-positive frequencies', () => {
    expect(() => frequencyToMidi(0)).toThrow(RangeError)
    expect(() => frequencyToMidi(-10)).toThrow(RangeError)
  })

  it('names notes with octave numbers', () => {
    expect(midiToNoteName(60).label).toBe('C4')
    expect(midiToNoteName(40).label).toBe('E2')
    expect(midiToNoteName(70)).toEqual({ pitchClass: 'A#', octave: 4, label: 'A#4' })
  })
})

describe('guitar numbers', () => {
  it.each(mapping.valid)('parses $number', ({ number, stringNumber, fret }) => {
    expect(parseGuitarNumber(number)).toEqual({ ok: true, value: { stringNumber, fret } })
  })

  it.each(mapping.invalid)('rejects "%s" with a message', (text) => {
    const result = parseGuitarNumber(text)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(10)
  })

  it('ignores surrounding whitespace', () => {
    expect(parseGuitarNumber(' 13 ')).toEqual({ ok: true, value: { stringNumber: 1, fret: 3 } })
  })

  it('respects a configurable max fret', () => {
    expect(parseGuitarNumber('115', 12).ok).toBe(false)
    expect(parseGuitarNumber('112', 12).ok).toBe(true)
  })

  it('round-trips formatting for every position', () => {
    for (const stringNumber of STRING_NUMBERS) {
      for (let fret = 0; fret <= 24; fret++) {
        const text = formatGuitarNumber({ stringNumber, fret })
        expect(parseGuitarNumber(text)).toEqual({ ok: true, value: { stringNumber, fret } })
      }
    }
  })

  it('describes positions in words', () => {
    expect(describePosition({ stringNumber: 1, fret: 3 })).toBe('string 1, fret 3')
    expect(describePosition({ stringNumber: 6, fret: 0 })).toBe('string 6, open')
  })
})

describe('fretboard mapping (standard tuning)', () => {
  it.each(mapping.valid)('$number is $note ($frequency Hz)', ({ stringNumber, fret, midi, note, frequency }) => {
    const position = { stringNumber: stringNumber as 1, fret }
    expect(positionToMidi(position)).toBe(midi)
    expect(midiToNoteName(midi).label).toBe(note)
    expect(midiToFrequency(midi)).toBeCloseTo(frequency, 2)
  })

  it('maps every open string to standard tuning', () => {
    const open = STRING_NUMBERS.map((s) => midiToNoteName(positionToMidi({ stringNumber: s, fret: 0 })).label)
    expect(open).toEqual(['E4', 'B3', 'G3', 'D3', 'A2', 'E2'])
  })

  it('finds every position for a pitch', () => {
    expect(positionsForMidi(64).map(formatGuitarNumber)).toEqual(['10', '25', '39', '414', '519', '624'])
    expect(positionsForMidi(40).map(formatGuitarNumber)).toEqual(['60'])
    expect(positionsForMidi(39)).toEqual([]) // below the low E string
    expect(positionsForMidi(89)).toEqual([]) // above string 1, fret 24
  })

  it('validates positions', () => {
    expect(validatePosition({ stringNumber: 1, fret: 24 })).toBeNull()
    expect(validatePosition({ stringNumber: 1, fret: 25 })).toMatch(/highest fret/)
    expect(validatePosition({ stringNumber: 1, fret: -1 })).toMatch(/not valid/)
    expect(validatePosition({ stringNumber: 1, fret: 2.5 })).toMatch(/not valid/)
    expect(validatePosition({ stringNumber: 7 as 1, fret: 0 })).toMatch(/does not exist/)
    expect(() => positionToMidi({ stringNumber: 1, fret: 30 })).toThrow(RangeError)
  })

  it('supports other tunings as data', () => {
    const dropD: Tuning = { ...STANDARD_TUNING, id: 'drop-d', openStringMidi: { ...STANDARD_TUNING.openStringMidi, 6: 38 } }
    expect(midiToNoteName(positionToMidi({ stringNumber: 6, fret: 0 }, dropD)).label).toBe('D2')
    expect(positionToMidi({ stringNumber: 6, fret: 2 }, dropD)).toBe(40)
  })
})

describe('same note on other strings', () => {
  const numbers = (positions: { stringNumber: number; fret: number }[]) => positions.map((p) => `${p.stringNumber}${p.fret}`)

  it('finds the places that sound exactly the same (the client examples)', () => {
    expect(numbers(samePitchPositions({ stringNumber: 1, fret: 0 }))).toEqual(['25', '39'])
    expect(numbers(samePitchPositions({ stringNumber: 2, fret: 0 }))).toEqual(['34', '49'])
    expect(numbers(samePitchPositions({ stringNumber: 1, fret: 1 }))).toEqual(['26', '310'])
    expect(numbers(samePitchPositions({ stringNumber: 2, fret: 5 }))).toEqual(['10', '39'])
  })

  it('has none for notes only one string can play, and stays within fret 12', () => {
    expect(samePitchPositions({ stringNumber: 6, fret: 0 })).toEqual([])
    expect(numbers(samePitchPositions({ stringNumber: 1, fret: 12 }))).toEqual([]) // 217, 321… are above fret 12
  })
})
