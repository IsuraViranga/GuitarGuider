// The instructor's numbering system: first digit = string (1–6), remaining digits = fret.
//   "13"  → string 1, fret 3
//   "60"  → string 6, open string (fret 0)
//   "112" → string 1, fret 12
// Elsewhere in the app a position is always the structured GuitarPosition, never the text.

import { DEFAULT_MAX_FRET, isStringNumber, type StringNumber } from './tuning'

export type GuitarPosition = {
  stringNumber: StringNumber
  fret: number
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function parseGuitarNumber(
  text: string,
  maxFret: number = DEFAULT_MAX_FRET,
): ParseResult<GuitarPosition> {
  const value = text.trim()
  if (!/^\d+$/.test(value)) {
    return { ok: false, error: `"${text}" is not a guitar number. Use digits only, e.g. 13.` }
  }
  if (value.length < 2) {
    return {
      ok: false,
      error: `"${value}" is too short. Write the string then the fret, e.g. ${value}0 for string ${value} open.`,
    }
  }

  const stringNumber = Number(value[0])
  if (!isStringNumber(stringNumber)) {
    return { ok: false, error: `"${value}" starts with string ${stringNumber}. Strings are numbered 1 to 6.` }
  }

  const fretText = value.slice(1)
  if (fretText.length > 1 && fretText.startsWith('0')) {
    return {
      ok: false,
      error: `"${value}" has a leading zero in the fret. Write ${stringNumber}${Number(fretText)} instead.`,
    }
  }
  const fret = Number(fretText)
  if (fret > maxFret) {
    return { ok: false, error: `"${value}" means fret ${fret}, but the highest fret is ${maxFret}.` }
  }

  return { ok: true, value: { stringNumber, fret } }
}

export function formatGuitarNumber(position: GuitarPosition): string {
  return `${position.stringNumber}${position.fret}`
}

/** Human-readable position, e.g. "string 1, fret 3" or "string 6, open". */
export function describePosition(position: GuitarPosition): string {
  const fret = position.fret === 0 ? 'open' : `fret ${position.fret}`
  return `string ${position.stringNumber}, ${fret}`
}

export function samePosition(a: GuitarPosition, b: GuitarPosition): boolean {
  return a.stringNumber === b.stringNumber && a.fret === b.fret
}
