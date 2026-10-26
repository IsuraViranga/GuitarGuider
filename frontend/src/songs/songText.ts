// Writes a song back as text the "Add a song" page can read again: one numbers line per measure
// (chords in brackets), with a words line underneath when every step has a one-word lyric.
// Used for songs that were not made from text (the built-in samples), so they can still be edited.

import { formatChordNumbers } from '../music/chords'
import { formatGuitarNumber } from '../music/guitarNumber'
import type { Song, SongNote } from './types'

function stepText(note: SongNote): string {
  if (note.chord) return formatChordNumbers(note.chord.tones.map((tone) => tone.position))
  return note.position ? formatGuitarNumber(note.position) : '?'
}

export function songToText(song: Pick<Song, 'notes'>): string {
  const lines: SongNote[][] = []
  for (const note of song.notes) {
    const last = lines.at(-1)
    if (last && last[0].measure === note.measure) last.push(note)
    else lines.push([note])
  }
  // Words only when they can be matched one by one (see the song sheet format).
  const wordsOf = (line: SongNote[]) => {
    const words = line.map((note) => note.lyric ?? '')
    return words.every((word) => word && !/\s/.test(word)) ? words.join(' ') : null
  }
  const anyWords = lines.some((line) => wordsOf(line) !== null)
  if (!anyWords) {
    // Plain instructor's numbers: "|" keeps the measures.
    return lines.map((line) => line.map(stepText).join(' ')).join(' |\n')
  }
  // Song sheet: each numbers line is a measure; words underneath where there are some.
  return lines
    .map((line) => {
      const words = wordsOf(line)
      const numbers = line.map(stepText).join(' ')
      return words ? `${numbers}\n${words}` : numbers
    })
    .join('\n\n')
}
