// Chords: turning a chord name (from any chord chart, e.g. "Am", "F#m7", "C/G") into the guitar
// positions to play, written in the instructor's numbers as "[52 41 30 21 10]" (thickest
// string first), e.g. C = [53 42 30 21 10]. Common chords use the open shapes beginners learn first; everything else uses
// standard movable barre shapes. Unusual chords are simplified to the nearest playable shape, and
// the result says so, so the user is never silently given something different.

import { positionToMidi } from './fretboard'
import { formatGuitarNumber, parseGuitarNumber, type GuitarPosition } from './guitarNumber'
import { STANDARD_TUNING, type StringNumber } from './tuning'

/** Frets for strings 6 → 1 (thickest to thinnest); null = string not played. */
type Shape = readonly (number | null)[]

export type Quality = 'maj' | 'm' | '7' | 'maj7' | 'm7' | 'sus2' | 'sus4' | 'dim' | 'aug' | '5' | 'add9' | 'm7b5'

export type ChordShapeResult = {
  name: string
  positions: GuitarPosition[]
  /** Set when the chord was simplified to a playable shape, e.g. "C9 played as C7". */
  simplifiedFrom?: string
}

const PITCH_CLASS: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0,
}
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Spelling found in chord charts → the quality we can play, and whether that is a simplification. */
const QUALITY_ALIASES: Record<string, { quality: Quality; simplified?: boolean }> = {
  '': { quality: 'maj' }, M: { quality: 'maj' }, maj: { quality: 'maj' },
  m: { quality: 'm' }, min: { quality: 'm' }, '-': { quality: 'm' },
  '7': { quality: '7' }, dom7: { quality: '7' },
  maj7: { quality: 'maj7' }, M7: { quality: 'maj7' }, 'Δ': { quality: 'maj7' }, 'Δ7': { quality: 'maj7' },
  m7: { quality: 'm7' }, min7: { quality: 'm7' }, '-7': { quality: 'm7' },
  sus2: { quality: 'sus2' }, sus4: { quality: 'sus4' }, sus: { quality: 'sus4' },
  // ("o" for diminished is not accepted: it would turn lyric words like "Go" into chords.)
  dim: { quality: 'dim' }, '°': { quality: 'dim' },
  aug: { quality: 'aug' }, '+': { quality: 'aug' },
  '5': { quality: '5' },
  add9: { quality: 'add9' }, add2: { quality: 'add9' },
  m7b5: { quality: 'm7b5' }, 'ø': { quality: 'm7b5' }, 'ø7': { quality: 'm7b5' },
  // Richer chords: played with the closest common shape (a beginner-friendly simplification).
  '6': { quality: 'maj', simplified: true }, m6: { quality: 'm', simplified: true },
  '9': { quality: '7', simplified: true }, '11': { quality: '7', simplified: true }, '13': { quality: '7', simplified: true },
  maj9: { quality: 'maj7', simplified: true }, m9: { quality: 'm7', simplified: true }, m11: { quality: 'm7', simplified: true },
  '7sus4': { quality: 'sus4', simplified: true }, '7sus2': { quality: 'sus2', simplified: true },
  dim7: { quality: 'dim', simplified: true }, madd9: { quality: 'm', simplified: true },
  '6/9': { quality: 'maj', simplified: true }, '69': { quality: 'maj', simplified: true },
}

/** Open (first-position) shapes, the ones beginners learn. */
const OPEN_SHAPES: Record<string, Shape> = {
  C: [null, 3, 2, 0, 1, 0], C7: [null, 3, 2, 3, 1, 0], Cmaj7: [null, 3, 2, 0, 0, 0],
  Cadd9: [null, 3, 2, 0, 3, 0], Csus2: [null, 3, 0, 0, 1, 3], Csus4: [null, 3, 3, 0, 1, 1],
  D: [null, null, 0, 2, 3, 2], Dm: [null, null, 0, 2, 3, 1], D7: [null, null, 0, 2, 1, 2],
  Dmaj7: [null, null, 0, 2, 2, 2], Dm7: [null, null, 0, 2, 1, 1], Dsus2: [null, null, 0, 2, 3, 0],
  Dsus4: [null, null, 0, 2, 3, 3],
  E: [0, 2, 2, 1, 0, 0], Em: [0, 2, 2, 0, 0, 0], E7: [0, 2, 0, 1, 0, 0], Em7: [0, 2, 0, 0, 0, 0],
  Emaj7: [0, 2, 1, 1, 0, 0], Esus4: [0, 2, 2, 2, 0, 0], E5: [0, 2, 2, null, null, null],
  F: [1, 3, 3, 2, 1, 1], Fmaj7: [null, null, 3, 2, 1, 0],
  G: [3, 2, 0, 0, 0, 3], G7: [3, 2, 0, 0, 0, 1], Gmaj7: [3, 2, 0, 0, 0, 2],
  A: [null, 0, 2, 2, 2, 0], Am: [null, 0, 2, 2, 1, 0], A7: [null, 0, 2, 0, 2, 0], Am7: [null, 0, 2, 0, 1, 0],
  Amaj7: [null, 0, 2, 1, 2, 0], Asus2: [null, 0, 2, 2, 0, 0], Asus4: [null, 0, 2, 2, 3, 0],
  A5: [null, 0, 2, 2, null, null],
  B7: [null, 2, 1, 2, 0, 2],
}

/** Movable shapes, as offsets from the root's fret; root on string 6 ("E shape") or string 5 ("A shape"). */
const E_SHAPES: Partial<Record<Quality, Shape>> = {
  maj: [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, null, 1, 1, 0, null], sus4: [0, 2, 2, 2, 0, 0], '5': [0, 2, 2, null, null, null],
}
const A_SHAPES: Partial<Record<Quality, Shape>> = {
  maj: [null, 0, 2, 2, 2, 0], m: [null, 0, 2, 2, 1, 0], '7': [null, 0, 2, 0, 2, 0], m7: [null, 0, 2, 0, 1, 0],
  maj7: [null, 0, 2, 1, 2, 0], sus2: [null, 0, 2, 2, 0, 0], sus4: [null, 0, 2, 2, 3, 0],
  dim: [null, 0, 1, 2, 1, null], aug: [null, 0, 3, 2, 2, 1], '5': [null, 0, 2, 2, null, null],
  m7b5: [null, 0, 1, 0, 1, null],
}
/** add9 has no common movable shape: played as the major chord (simplified). */
const QUALITY_FALLBACK: Partial<Record<Quality, Quality>> = { add9: 'maj' }

const CHORD_NAME = /^([A-G])(#|b)?([^/]*)(?:\/([A-G])(#|b)?)?$/

/** True when the text looks like a chord name ("Am", "F#m7", "C/G", "Bb", "Gsus4"). */
export function isChordName(text: string): boolean {
  const match = CHORD_NAME.exec(text)
  return Boolean(match && match[3] in QUALITY_ALIASES)
}

function suffixFor(quality: Quality): string {
  return quality === 'maj' ? '' : quality
}

function shapeToPositions(shape: Shape): GuitarPosition[] {
  const positions: GuitarPosition[] = []
  shape.forEach((fret, i) => {
    if (fret !== null) positions.push({ stringNumber: (6 - i) as StringNumber, fret })
  })
  return positions
}

function shapeFor(root: number, quality: Quality): { shape: Shape; quality: Quality } | null {
  const open = OPEN_SHAPES[SHARP_NAMES[root] + suffixFor(quality)]
  if (open) return { shape: open, quality }
  const eFret = (root - 4 + 12) % 12 // root's fret on string 6 (E)
  const aFret = (root - 9 + 12) % 12 // root's fret on string 5 (A)
  const candidates = [
    E_SHAPES[quality] && { fret: eFret, shape: E_SHAPES[quality]! },
    A_SHAPES[quality] && { fret: aFret, shape: A_SHAPES[quality]! },
  ].filter((c): c is { fret: number; shape: Shape } => Boolean(c))
  if (candidates.length === 0) {
    const fallback = QUALITY_FALLBACK[quality]
    return fallback ? shapeFor(root, fallback) : null
  }
  // The shape played lowest on the neck is the easiest to reach.
  const best = candidates.reduce((a, b) => (b.fret < a.fret ? b : a))
  return { shape: best.shape.map((offset) => (offset === null ? null : offset + best.fret)), quality }
}

/** Adds a different bass note ("C/G") on a lower string if it fits the shape; otherwise null. */
function withBass(shape: Shape, bass: number): Shape | null {
  const played = shape.map((f, i) => ({ f, i })).filter((s) => s.f !== null)
  const frets = played.map((s) => s.f!).filter((f) => f > 0)
  const low = frets.length ? Math.min(...frets) : 0
  const high = frets.length ? Math.max(...frets) : 0
  const lowestString = played[0].i // index 0 = string 6
  for (let i = 0; i <= Math.min(lowestString, 1); i++) {
    const openMidi = STANDARD_TUNING.openStringMidi[(6 - i) as StringNumber]
    for (let fret = 0; fret <= 15; fret++) {
      const reachable = fret === 0 || (fret >= low - 1 && fret <= Math.max(high, low + 3))
      if (reachable && (openMidi + fret) % 12 === bass) {
        return shape.map((f, j) => (j < i ? null : j === i ? fret : f))
      }
    }
  }
  return null
}

/** The positions to play for a chord name, or an explanation if it cannot be understood. */
export function chordShape(name: string): { ok: true; value: ChordShapeResult } | { ok: false; error: string } {
  const match = CHORD_NAME.exec(name.trim())
  const alias = match ? QUALITY_ALIASES[match[3]] : undefined
  if (!match || !alias) return { ok: false, error: `"${name}" is not a chord name this app knows.` }

  const root = PITCH_CLASS[match[1] + (match[2] ?? '')]
  const found = shapeFor(root, alias.quality)
  if (!found) return { ok: false, error: `No guitar shape is available for "${name}".` }

  let shape = found.shape
  let simplified = Boolean(alias.simplified) || found.quality !== alias.quality
  if (match[4]) {
    const bass = PITCH_CLASS[match[4] + (match[5] ?? '')]
    const withBassNote = withBass(shape, bass)
    if (withBassNote) shape = withBassNote
    else simplified = true
  }
  const playedAs = SHARP_NAMES[root] + suffixFor(found.quality)
  return {
    ok: true,
    value: {
      name: name.trim(),
      positions: shapeToPositions(shape),
      ...(simplified ? { simplifiedFrom: `${name.trim()} is played as ${playedAs}` } : {}),
    },
  }
}

/** "[52 41 30 21 10]": the instructor's numbers for a chord, thickest string first. */
export function formatChordNumbers(positions: readonly GuitarPosition[]): string {
  const ordered = [...positions].sort((a, b) => b.stringNumber - a.stringNumber)
  return `[${ordered.map(formatGuitarNumber).join(' ')}]`
}

/** Parses "[52 41 30 21 10]" (brackets optional) into positions, one per string. */
export function parseChordNumbers(text: string, maxFret?: number): { ok: true; value: GuitarPosition[] } | { ok: false; error: string } {
  const inner = text.trim().replace(/^\[|\]$/g, '').trim()
  if (!inner) return { ok: false, error: 'A chord needs at least two numbers inside [ ].' }
  const positions: GuitarPosition[] = []
  for (const token of inner.split(/[\s,]+/)) {
    const parsed = parseGuitarNumber(token, maxFret)
    if (!parsed.ok) return parsed
    if (positions.some((p) => p.stringNumber === parsed.value.stringNumber)) {
      return { ok: false, error: `String ${parsed.value.stringNumber} appears twice in the chord [${inner}]; each string can play one note.` }
    }
    positions.push(parsed.value)
  }
  if (positions.length < 2) return { ok: false, error: `[${inner}] has only one note; write single notes without brackets.` }
  return { ok: true, value: positions.sort((a, b) => b.stringNumber - a.stringNumber) }
}

const QUALITY_INTERVALS: Array<[Quality, number[]]> = [
  ['maj', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
  ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['5', [0, 7]],
  ['add9', [0, 2, 4, 7]], ['m7b5', [0, 3, 6, 10]],
]

/** Names a set of positions ("C", "Am", "C/G"), or null if it is not a common chord. */
export function identifyChord(positions: readonly GuitarPosition[]): string | null {
  const midis = positions.map((p) => positionToMidi(p))
  const classes = new Set(midis.map((m) => m % 12))
  const bass = Math.min(...midis) % 12
  const matches: string[] = []
  for (let root = 0; root < 12; root++) {
    for (const [quality, intervals] of QUALITY_INTERVALS) {
      const wanted = new Set(intervals.map((i) => (root + i) % 12))
      if (wanted.size === classes.size && [...wanted].every((c) => classes.has(c))) {
        const name = SHARP_NAMES[root] + suffixFor(quality)
        matches.push(root === bass ? name : `${name}/${SHARP_NAMES[bass]}`)
      }
    }
  }
  // Prefer the reading whose root is the bass note (no slash).
  return matches.find((m) => !m.includes('/')) ?? matches[0] ?? null
}
