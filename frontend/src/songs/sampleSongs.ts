// Built-in practice material. All arrangements were written for this app.
// "Ode to Joy" is Beethoven's melody (public domain); the guitar arrangement is ours.

import { STANDARD_TUNING } from '../music/tuning'
import { parseGuitarNumberText } from './parsers/guitarNumberText'
import type { Difficulty, Song } from './types'
import { notesFromPositions } from './validation'

function sample(id: string, title: string, difficulty: Difficulty, description: string, numbers: string): Song {
  const parsed = parseGuitarNumberText(numbers, STANDARD_TUNING)
  if (!parsed.ok) {
    throw new Error(`Sample song "${id}" is invalid: ${parsed.issues.map((issue) => issue.message).join('; ')}`)
  }
  return {
    id,
    title,
    description,
    difficulty,
    tuningId: STANDARD_TUNING.id,
    source: 'sample',
    notes: notesFromPositions(parsed.value.notes, STANDARD_TUNING),
  }
}

export const SAMPLE_SONGS: readonly Song[] = [
  sample(
    'sample-open-strings',
    'Open Strings Warm-up',
    'beginner',
    'Play each open string from thickest to thinnest and back. No fretting needed.',
    '60 50 40 30 | 20 10 10 20 | 30 40 50 60',
  ),
  sample(
    'sample-first-frets',
    'First Frets on String 1',
    'beginner',
    'Open, fret 1 and fret 3 on the thinnest string.',
    '10 11 13 11 | 10 13 11 10',
  ),
  sample(
    'sample-c-major-scale',
    'C Major Scale',
    'beginner',
    'One octave up and back down, from C on string 5.',
    '53 40 42 43 | 30 32 20 21 | 21 20 32 30 | 43 42 40 53',
  ),
  sample(
    'sample-morning-steps',
    'Morning Steps',
    'beginner',
    'A short original melody on strings 1 and 2.',
    '21 23 10 11 | 13 11 10 23 | 21 23 20 21',
  ),
  sample(
    'sample-ode-to-joy',
    'Ode to Joy (melody)',
    'beginner',
    "Beethoven's melody (public domain), arranged for this app. Has repeated notes.",
    '10 10 11 13 | 13 11 10 23 | 21 21 23 10 | 10 23 23',
  ),
  sample(
    'sample-up-the-neck',
    'Up the Neck',
    'intermediate',
    'Climb string 1 to fret 12 and back. Practises reading two-digit frets.',
    '15 17 18 110 | 112 110 18 17 | 15',
  ),
]
