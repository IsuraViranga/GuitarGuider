// Dataset collector: what the admin sees about a recorded pluck before saving it, and the
// settings that stay the same from one recording to the next.

import type { PracticeRecording } from '../audio/listeningSession'
import { midiToFrequency, midiToNoteName } from '../music/pitch'
import { STANDARD_TUNING, type StringNumber } from '../music/tuning'
import type { Device, GuitarType, Noise, PluckMethod, PluckStrength, PositionCount, StringMaterial } from './datasetApi'

/** Recording stops by itself this long after the pluck (attack and most of the ring)... */
export const AFTER_PLUCK_MS = 4000
/** ...or at the latest after this long, with or without a pluck. */
export const MAX_TAKE_SECONDS = 10
/** "Get ready", then "Pluck now": keeps some quiet sound before the pluck. */
export const READY_MS = 600
/** The frets the progress grid shows first: the client's target. */
export const MAIN_FRETS = 7

export const PLUCK_TARGETS = [3, 5, 10] as const

export type Position = { stringNumber: StringNumber; fret: number }

export function expectedNote({ stringNumber, fret }: Position) {
  const midi = STANDARD_TUNING.openStringMidi[stringNumber] + fret
  return { midi, label: midiToNoteName(midi).label, hz: Math.round(midiToFrequency(midi) * 100) / 100 }
}

export const positionCode = ({ stringNumber, fret }: Position) => `${stringNumber}${fret}`

/** Usual wound strings by guitar type (changeable when adding a guitar). */
export const DEFAULT_WOUND: Record<GuitarType, number[]> = {
  acoustic: [3, 4, 5, 6],
  classical: [4, 5, 6],
  electric: [4, 5, 6],
  other: [4, 5, 6],
}

export const defaultMaterial = (type: GuitarType): StringMaterial => (type === 'classical' ? 'nylon' : 'steel')

export function woundLabel(woundStrings: number[] | null, stringNumber: number): string {
  if (woundStrings === null) return 'wound?'
  return woundStrings.includes(stringNumber) ? 'wound' : 'plain'
}

// ---------- checking a take ----------

export type PluckCheck = {
  /** When the pluck started, ms from the start of the recording (null: none heard). */
  pluckAtMs: number | null
  peak: number
  /** Short warnings; the admin decides (nothing is blocked). */
  warnings: string[]
}

const CLIPPED = 0.99
const QUIET = 0.02
/** Onsets closer than this are one pluck. */
const SAME_PLUCK_MS = 300
/** A pluck in the first moment of the recording may have lost its start. */
const TOO_EARLY_MS = 150

export function checkPluck(recording: PracticeRecording, expectedMidi: number): PluckCheck {
  let peak = 0
  for (const value of recording.samples) peak = Math.max(peak, Math.abs(value))
  const onsets: number[] = []
  for (const frame of recording.log.frames) if (frame.onset && (onsets.length === 0 || frame.t - onsets.at(-1)! >= SAME_PLUCK_MS)) onsets.push(frame.t)
  const heard = recording.log.events.find((event) => event.kind === 'noteStart' && typeof event.midi === 'number')
  const warnings: string[] = []
  if (peak >= CLIPPED) warnings.push('Too loud: the sound was cut off (clipped). Pluck a little softer.')
  else if (peak < QUIET) warnings.push('Very quiet. Pluck a little harder or bring the phone closer.')
  if (onsets.length === 0) warnings.push('No pluck was heard.')
  if (onsets.length > 1) warnings.push(`${onsets.length} plucks were heard. Retake for one clean pluck.`)
  if (onsets.length > 0 && onsets[0] < TOO_EARLY_MS) warnings.push('The pluck came right at the start. Retake and wait for “Pluck now”.')
  if (heard && Math.abs((heard.midi as number) - expectedMidi) > 0.5) {
    warnings.push(`Heard ${midiToNoteName(Math.round(heard.midi as number)).label}, expected ${midiToNoteName(expectedMidi).label}. Check the string, the fret and the tuning.`)
  }
  return { pluckAtMs: onsets[0] ?? null, peak, warnings }
}

// ---------- the next position ----------

export const countKey = (stringNumber: number, fret: number) => `${stringNumber}-${fret}`

export function countsOf(progress: PositionCount[]): Map<string, number> {
  return new Map(progress.map((p) => [countKey(p.stringNumber, p.fret), p.count]))
}

/** The next position after `from` (string 1 to 6, fret 0 to maxFret) with fewer than `target` samples. */
export function nextIncomplete(counts: Map<string, number>, from: Position, target: number, maxFret = MAIN_FRETS): Position | null {
  const order: Position[] = []
  for (const stringNumber of [1, 2, 3, 4, 5, 6] as StringNumber[]) for (let fret = 0; fret <= maxFret; fret++) order.push({ stringNumber, fret })
  const start = order.findIndex((p) => p.stringNumber === from.stringNumber && p.fret === from.fret)
  for (let step = 1; step <= order.length; step++) {
    const p = order[(start + step + order.length) % order.length]
    if ((counts.get(countKey(p.stringNumber, p.fret)) ?? 0) < target) return p
  }
  return null
}

// ---------- settings kept between recordings (this browser) ----------

export type Session = {
  guitarId: string | null
  backgroundNoise: Noise
  pluckMethod: PluckMethod
  pluckStrength: PluckStrength
  device: Device | null
  target: number
  position: Position
}

export const DEFAULT_SESSION: Session = {
  guitarId: null,
  backgroundNoise: 'quiet',
  pluckMethod: 'finger',
  pluckStrength: 'medium',
  device: 'phone',
  target: 5,
  position: { stringNumber: 1, fret: 0 },
}

const SESSION_KEY = 'guitar-practice:dataset-session'

export function loadSession(): Session {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Partial<Session> | null
    return saved ? { ...DEFAULT_SESSION, ...saved } : DEFAULT_SESSION
  } catch {
    return DEFAULT_SESSION
  }
}

export function saveSession(session: Session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Private window or storage blocked: the settings just are not remembered.
  }
}
