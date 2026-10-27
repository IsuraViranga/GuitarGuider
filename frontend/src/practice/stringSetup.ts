// Guitar setup for the string check: how stiff each open string of the student's guitar is,
// measured once by plucking each open string a few times, and remembered in this browser.
// New strings or another guitar: do the setup again (it takes about 30 seconds).

import { useState } from 'react'
import {
  CHECKABLE_RATIO,
  isClean,
  MAX_STRING_MISFIT,
  predictStiffness,
  regularityRange,
  type GuitarStrings,
  type OpenStringStiffness,
  type Stiffness,
} from '../audio/stringCheck'
import { STRING_NUMBERS, type StringNumber, type Tuning } from '../music/tuning'

/** Clear plucks of one open string that must agree before its stiffness is kept. */
export const SETUP_PLUCKS = 3
/** They agree when each is within this fraction of their middle value. */
const AGREEMENT = 0.15

const STORAGE_KEY = 'guitar-practice:string-setup'

/** Each measured open string's stiffness (B) and usual misfit (see GuitarStrings). */
export type StringSetup = GuitarStrings & { savedAt: string }

/**
 * A pluck clear enough for the setup. Wound strings fit their curve less regularly than plain
 * ones (string 3 about 2.5 cents on a real guitar), so anything up to MAX_STRING_MISFIT counts;
 * plucks disturbed by another string or a buzz measured above it.
 */
export function isClearPluck(stiffness: Stiffness | null): stiffness is Stiffness {
  return isClean(stiffness, MAX_STRING_MISFIT)
}

/**
 * What to keep for a string from its plucks so far, once the newest SETUP_PLUCKS clear ones agree:
 * their middle B and their middle misfit (how regular this string's overtones normally are).
 * Otherwise null (keep plucking).
 */
export function settledStiffness(plucks: readonly (Stiffness | null)[]): { b: number; misfit: number } | null {
  const clear = plucks.filter(isClearPluck)
  if (clear.length < SETUP_PLUCKS) return null
  const newest = clear.slice(-SETUP_PLUCKS)
  const middle = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]
  const b = middle(newest.map((s) => s.b))
  if (!newest.every((s) => Math.abs(s.b - b) <= AGREEMENT * b)) return null
  return { b, misfit: middle(newest.map((s) => s.misfit)) }
}

export function loadStringSetup(): StringSetup | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StringSetup>
    const open: OpenStringStiffness = {}
    const misfit: NonNullable<GuitarStrings['misfit']> = {}
    for (const string of STRING_NUMBERS) {
      const b = parsed.open?.[string]
      if (typeof b === 'number' && b > 0 && b < 0.01) open[string] = b
      const m = parsed.misfit?.[string]
      if (typeof m === 'number' && m >= 0 && m <= MAX_STRING_MISFIT) misfit[string] = m
    }
    if (Object.keys(open).length === 0 || typeof parsed.savedAt !== 'string') return null
    // Setups saved before the misfit was learned have none: plain-string limits apply.
    return Object.keys(misfit).length > 0 ? { open, misfit, savedAt: parsed.savedAt } : { open, savedAt: parsed.savedAt }
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
  misfit: NonNullable<GuitarStrings['misfit']>
  /** Strings skipped by the student or left out because they gave no clear measurement. */
  left: readonly StringNumber[]
  /** What happened on the last pluck, for the message under the picks. */
  last: 'counted' | 'unclear' | 'not-same' | 'kept' | 'left-out' | null
}

export type SetupAction = { type: 'pluck'; stiffness: Stiffness | null } | { type: 'skip' } | { type: 'restart' }

export const INITIAL_SETUP: SetupState = { index: 0, tries: [], open: {}, misfit: {}, left: [], last: null }

export function setupString(state: SetupState): StringNumber | null {
  return SETUP_ORDER[state.index] ?? null
}

/** Clear plucks shown as filled picks for the current string (at most SETUP_PLUCKS). */
export function countedPlucks(state: SetupState): number {
  return Math.min(state.tries.filter(isClearPluck).length, SETUP_PLUCKS)
}

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  if (action.type === 'restart') return INITIAL_SETUP
  const string = setupString(state)
  if (string === null) return state
  const next = (changes: Partial<SetupState>): SetupState => ({ ...state, index: state.index + 1, tries: [], ...changes })
  if (action.type === 'skip') return next({ left: [...state.left, string], last: null })

  const tries = [...state.tries, action.stiffness]
  const settled = settledStiffness(tries)
  if (settled !== null) {
    return next({ open: { ...state.open, [string]: settled.b }, misfit: { ...state.misfit, [string]: settled.misfit }, last: 'kept' })
  }
  if (tries.length >= MAX_SETUP_TRIES) return next({ left: [...state.left, string], last: 'left-out' })
  let last: SetupState['last'] = 'counted'
  if (!isClearPluck(action.stiffness)) last = 'unclear'
  else if (tries.filter(isClearPluck).length >= SETUP_PLUCKS) last = 'not-same'
  return { ...state, tries, last }
}

export type PairStatus = 'checked' | 'too-alike' | 'not-measured'

/**
 * Whether the app can tell neighbouring strings apart on this guitar (for the setup summary): by
 * stiffness (the ratio for the same note is the same at every fret) or by how regular they are.
 */
export function neighbourPairs(strings: GuitarStrings, tuning: Tuning): Array<{ strings: [StringNumber, StringNumber]; status: PairStatus }> {
  return STRING_NUMBERS.slice(0, -1).map((thinner) => {
    const thicker = (thinner + 1) as StringNumber
    const gap = tuning.openStringMidi[thinner] - tuning.openStringMidi[thicker]
    const a = predictStiffness(strings.open, { stringNumber: thinner, fret: 0 })
    const b = predictStiffness(strings.open, { stringNumber: thicker, fret: gap })
    let status: PairStatus = 'not-measured'
    if (a !== null && b !== null) {
      const apart = Math.max(a / b, b / a) >= CHECKABLE_RATIO || regularityRange(strings, thinner, thicker) !== null
      status = apart ? 'checked' : 'too-alike'
    }
    return { strings: [thinner, thicker], status }
  })
}
