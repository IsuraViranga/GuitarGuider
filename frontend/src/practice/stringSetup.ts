// Guitar setup for the string check: how stiff each open string of the student's guitar is,
// measured once by plucking each open string a few times, and remembered in this browser.
// New strings or another guitar: do the setup again (it takes about 30 seconds).

import { useState } from 'react'
import { CHECKABLE_RATIO, isClean, predictStiffness, type OpenStringStiffness, type Stiffness } from '../audio/stringCheck'
import { STRING_NUMBERS, type StringNumber, type Tuning } from '../music/tuning'

/** Clean plucks of one open string that must agree before its stiffness is kept. */
export const SETUP_PLUCKS = 3
/** They agree when each is within this fraction of their middle value. */
const AGREEMENT = 0.15

const STORAGE_KEY = 'guitar-practice:string-setup'

export type StringSetup = {
  /** Stiffness (B) of each open string that was measured. */
  open: OpenStringStiffness
  savedAt: string
}

/**
 * The stiffness to keep for a string from its plucks so far: the middle of the newest
 * SETUP_PLUCKS clean ones, once they agree; otherwise null (keep plucking).
 */
export function settledStiffness(plucks: readonly (Stiffness | null)[]): number | null {
  const clean = plucks.filter(isClean).map((s) => s.b)
  if (clean.length < SETUP_PLUCKS) return null
  const newest = clean.slice(-SETUP_PLUCKS).sort((a, b) => a - b)
  const middle = newest[newest.length >> 1]
  return newest.every((b) => Math.abs(b - middle) <= AGREEMENT * middle) ? middle : null
}

export function loadStringSetup(): StringSetup | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StringSetup>
    const open: OpenStringStiffness = {}
    for (const string of STRING_NUMBERS) {
      const b = parsed.open?.[string]
      if (typeof b === 'number' && b > 0 && b < 0.01) open[string] = b
    }
    return Object.keys(open).length > 0 && typeof parsed.savedAt === 'string' ? { open, savedAt: parsed.savedAt } : null
  } catch {
    return null
  }
}

function storeStringSetup(setup: StringSetup | null) {
  try {
    if (setup) localStorage.setItem(STORAGE_KEY, JSON.stringify(setup))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Not saved (private mode or storage blocked); the setup still applies on this page.
  }
}

/** The saved setup, and functions to save a new one or remove it. */
export function useStringSetup(): [StringSetup | null, (setup: StringSetup | null) => void] {
  const [setup, setSetup] = useState(loadStringSetup)
  return [
    setup,
    (next: StringSetup | null) => {
      setSetup(next)
      storeStringSetup(next)
    },
  ]
}

/** The setup goes from the thinnest string to the thickest. */
export const SETUP_ORDER: readonly StringNumber[] = STRING_NUMBERS
/** A string that gives no agreeing clean plucks in this many tries is left out (not checked). */
export const MAX_SETUP_TRIES = 8

export type SetupState = {
  /** Position in SETUP_ORDER; SETUP_ORDER.length when finished. */
  index: number
  /** Measurements of the current string so far (null = not clear enough to measure). */
  tries: readonly (Stiffness | null)[]
  open: OpenStringStiffness
  /** Strings skipped by the student or left out because they gave no clear measurement. */
  left: readonly StringNumber[]
  /** What happened on the last pluck, for the message under the picks. */
  last: 'counted' | 'unclear' | 'not-same' | 'kept' | 'left-out' | null
}

export type SetupAction = { type: 'pluck'; stiffness: Stiffness | null } | { type: 'skip' } | { type: 'restart' }

export const INITIAL_SETUP: SetupState = { index: 0, tries: [], open: {}, left: [], last: null }

export function setupString(state: SetupState): StringNumber | null {
  return SETUP_ORDER[state.index] ?? null
}

/** Clean plucks shown as filled picks for the current string (at most SETUP_PLUCKS). */
export function countedPlucks(state: SetupState): number {
  return Math.min(state.tries.filter(isClean).length, SETUP_PLUCKS)
}

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  if (action.type === 'restart') return INITIAL_SETUP
  const string = setupString(state)
  if (string === null) return state
  const next = (open: OpenStringStiffness, left: readonly StringNumber[], last: SetupState['last']): SetupState => ({
    index: state.index + 1,
    tries: [],
    open,
    left,
    last,
  })
  if (action.type === 'skip') return next(state.open, [...state.left, string], null)

  const tries = [...state.tries, action.stiffness]
  const settled = settledStiffness(tries)
  if (settled !== null) return next({ ...state.open, [string]: settled }, state.left, 'kept')
  if (tries.length >= MAX_SETUP_TRIES) return next(state.open, [...state.left, string], 'left-out')
  let last: SetupState['last'] = 'counted'
  if (!isClean(action.stiffness)) last = 'unclear'
  else if (tries.filter(isClean).length >= SETUP_PLUCKS) last = 'not-same'
  return { ...state, tries, last }
}

export type PairStatus = 'checked' | 'too-alike' | 'not-measured'

/**
 * Whether the app can tell neighbouring strings apart on this guitar (for the setup summary).
 * For two strings the stiffness ratio of the same note is the same at every fret.
 */
export function neighbourPairs(open: OpenStringStiffness, tuning: Tuning): Array<{ strings: [StringNumber, StringNumber]; status: PairStatus }> {
  return STRING_NUMBERS.slice(0, -1).map((thinner) => {
    const thicker = (thinner + 1) as StringNumber
    const gap = tuning.openStringMidi[thinner] - tuning.openStringMidi[thicker]
    const a = predictStiffness(open, { stringNumber: thinner, fret: 0 })
    const b = predictStiffness(open, { stringNumber: thicker, fret: gap })
    const status: PairStatus = a === null || b === null ? 'not-measured' : Math.max(a / b, b / a) >= CHECKABLE_RATIO ? 'checked' : 'too-alike'
    return { strings: [thinner, thicker], status }
  })
}
