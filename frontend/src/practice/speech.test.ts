import { describe, expect, it } from 'vitest'
import type { SongNote } from '../songs/types'
import { chordToSpeech, correctionToSpeech, noteToSpeech } from './speech'

const single = (stringNumber: number, fret: number, midi: number): SongNote =>
  ({ index: 0, midi, position: { stringNumber, fret } }) as SongNote

describe('spoken guidance', () => {
  it('says the string and fret of a note', () => {
    expect(noteToSpeech(single(1, 3, 67))).toBe('String 1, fret 3.')
    expect(noteToSpeech(single(6, 0, 40))).toBe('String 6, open.')
    expect(noteToSpeech(single(1, 12, 76))).toBe('String 1, fret 12.')
  })

  it('after a mistake, says it was wrong and what to play instead', () => {
    const wrong = (heardMidi: number) =>
      ({ kind: 'incorrect', noteIndex: 0, targetMidi: 64, detectedMidi: heardMidi, heardMidi, octaveOff: false }) as const
    expect(correctionToSpeech(single(1, 0, 64), wrong(67))).toBe('Wrong note. Play string 1, open.')
    expect(correctionToSpeech(single(2, 3, 62), wrong(64))).toBe('Wrong note. Play string 2, fret 3.')
    // String 6 instead of string 1: same note name, two octaves lower.
    expect(correctionToSpeech(single(1, 0, 64), wrong(40))).toBe('Wrong string. Use string 1, the thinnest string.')
    expect(correctionToSpeech(single(6, 3, 43), wrong(67))).toBe('Wrong string. Use string 6, the thickest string.')
    const chord = { index: 0, midi: 48, chord: { name: 'C', tones: [] } } as unknown as SongNote
    expect(correctionToSpeech(chord, { kind: 'wrong-chord', noteIndex: 0, heard: 'G' })).toBe('Wrong chord. Play C major.')
    expect(correctionToSpeech(single(1, 0, 64), { kind: 'none' })).toBeNull()
    // The string check heard 25 instead of 10.
    expect(correctionToSpeech(single(1, 0, 64), { kind: 'wrong-string', noteIndex: 0, heard: { stringNumber: 2, fret: 5 }, movedOn: false })).toBe(
      'Wrong string. Play string 1, open.',
    )
  })

  it('says chord names the way a teacher would', () => {
    expect(chordToSpeech('C')).toBe('C major')
    expect(chordToSpeech('Am')).toBe('A minor')
    expect(chordToSpeech('F#m7')).toBe('F sharp minor seven')
    expect(chordToSpeech('Bb')).toBe('B flat major')
    expect(chordToSpeech('Gsus4')).toBe('G sus four')
    expect(chordToSpeech('C/G')).toBe('C major over G')
    const chord = { index: 0, midi: 48, chord: { name: 'Am', tones: [] } } as unknown as SongNote
    expect(noteToSpeech(chord)).toBe('A minor chord.')
  })
})
