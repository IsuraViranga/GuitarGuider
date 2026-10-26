// Writes a song back as text the "Add a song" page can read again, keeping its lines (and "|"
// bars): one numbers line per line of the sheet (chords in brackets), with a words line
// underneath when every step of that line has a one-word lyric.
// Used for songs that were not made from text (the built-in samples), so they can still be edited.
// Tested: every built-in song comes back with exactly the same notes.

import { formatChordNumbers } from '../music/chords'
import { formatGuitarNumber } from '../music/guitarNumber'
import type { Song, SongNote } from './types'

function stepText(note: SongNote): string {
  if (note.chord) return formatChordNumbers(note.chord.tones.map((tone) => tone.position))
  return note.position ? formatGuitarNumber(note.position) : '?'
}

function groupBy(notes: readonly SongNote[], key: (note: SongNote) => unknown): SongNote[][] {
  const groups: SongNote[][] = []
  for (const note of notes) {
    const last = groups.at(-1)
    if (last && key(last[0]) === key(note)) last.push(note)
    else groups.push([note])
  }
  return groups
}

/** The words of a line, if they can be matched one by one (see the song sheet format). */
function wordsOf(line: SongNote[]): string | null {
  const words = line.map((note) => note.lyric ?? '')
  return words.every((word) => word && !/\s/.test(word)) ? words.join(' ') : null
}

export function songToText(song: Pick<Song, 'notes'>): string {
  // Song sheet (some words): each sheet line is a numbers line, words underneath where possible.
  // Older songs without line numbers used one measure per sheet line.
  const sheetLines = groupBy(song.notes, (note) => note.line ?? note.measure)
  if (sheetLines.some((line) => wordsOf(line) !== null)) {
    return sheetLines
      .map((line) => {
        const words = wordsOf(line)
        const numbers = line.map(stepText).join(' ')
        return words ? `${numbers}\n${words}` : numbers
      })
      .join('\n\n')
  }

  // Instructor's numbers: one text line per line of the song; "|" wherever a new measure starts.
  const lines = groupBy(song.notes, (note) => note.line)
  return lines
    .map((line, i) => {
      let text = ''
      line.forEach((note, k) => {
        if (k > 0) text += note.measure !== line[k - 1].measure ? ' | ' : ' '
        text += stepText(note)
      })
      const next = lines[i + 1]
      if (next && next[0].measure !== line[line.length - 1].measure) text += ' |'
      return text
    })
    .join('\n')
}
