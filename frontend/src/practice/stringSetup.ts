// Guitar setup for the string check: how stiff each open string of the student's guitar is,
// measured once by plucking each open string a few times. Signed in, it is kept with the account
// (and a copy on this device, so practice works offline); visitors keep it in this browser only.
// New strings or another guitar: do the setup again (it takes about 30 seconds).

import { useEffect, useState } from 'react'
import { useAuth } from '../auth/authContext'
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
import { deleteAccountStringSetup, getAccountStringSetup, saveAccountStringSetup } from './stringSetupApi'

/** Clear plucks of one open string that must agree before its stiffness is kept. */
export const SETUP_PLUCKS = 3
/** They agree when each is within this fraction of their middle value. */
const AGREEMENT = 0.15

/** A visitor's setup (no account), in this browser. */
const STORAGE_KEY = 'guitar-practice:string-setup'
/** This device's copy of an account's setup. */
const accountKey = (userId: string) => `${STORAGE_KEY}:${userId}`

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

function loadStringSetup(key: string): StringSetup | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? parseStringSetup(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** A setup as stored (here or on the server), keeping only valid measurements. */
function parseStringSetup(value: unknown): StringSetup | null {
  try {
    const parsed = value as Partial<StringSetup>
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

function storeStringSetup(key: string, setup: StringSetup | null) {
  try {
    if (setup) localStorage.setItem(key, JSON.stringify(setup))
    else localStorage.removeItem(key)
  } catch {
    // Not saved (private mode or storage blocked); the setup still applies on this page.
  }
}

export type StringSetupState = {
  /** The setup to use, or null. */
  setup: StringSetup | null
  /** 'loading' while it is not known yet (signed in, nothing on this device, server not answered). */
  status: 'loading' | 'ready'
  /** Signed in, and the server says the account has no setup yet: practice asks for one first. */
  missingOnAccount: boolean
  /** A setup done on this device without an account, which a signed-in student may use for theirs. */
  deviceSetup: StringSetup | null
  /** Saves a new setup (to the account when signed in; may fail, e.g. offline). */
  save: (setup: StringSetup) => Promise<void>
  /** Deletes the setup (from the account when signed in; may fail, e.g. offline). */
  remove: () => Promise<void>
}

/**
 * The student's guitar setup. Signed in: the account's, fetched from the server (this device's
 * copy is used meanwhile, and when the server cannot be reached, so no network problem ever
 * blocks practice). Visitors: the one saved in this browser, if any.
 */
export function useStringSetup(): StringSetupState {
  const { status: authStatus, user } = useAuth()
  const userId = authStatus === 'signedIn' && user ? user.id : null
  const [visitorSetup, setVisitorSetup] = useState(() => loadStringSetup(STORAGE_KEY))
  /** The server's answer for this user: a setup, null (none yet), or 'unreachable'. */
  const [fetched, setFetched] = useState<{ userId: string; result: StringSetup | null | 'unreachable' } | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getAccountStringSetup()
      .then((setup) => {
        if (cancelled) return
        const result = parseStringSetup(setup)
        storeStringSetup(accountKey(userId), result)
        setFetched({ userId, result })
      })
      .catch(() => {
        if (!cancelled) setFetched({ userId, result: 'unreachable' })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const answer = fetched?.userId === userId ? fetched.result : undefined
  // This device's copy (updated with every answer from the server); a quick read.
  const deviceCopy = userId ? loadStringSetup(accountKey(userId)) : null

  if (!userId) {
    return {
      setup: visitorSetup,
      status: authStatus === 'loading' ? 'loading' : 'ready',
      missingOnAccount: false,
      deviceSetup: null,
      save: async (setup) => {
        setVisitorSetup(setup)
        storeStringSetup(STORAGE_KEY, setup)
      },
      remove: async () => {
        setVisitorSetup(null)
        storeStringSetup(STORAGE_KEY, null)
      },
    }
  }
  const setup = answer === undefined || answer === 'unreachable' ? deviceCopy : answer
  return {
    setup,
    status: answer === undefined && !deviceCopy ? 'loading' : 'ready',
    missingOnAccount: answer === null,
    deviceSetup: visitorSetup,
    save: async (next) => {
      const saved = parseStringSetup(await saveAccountStringSetup(next)) ?? next
      storeStringSetup(accountKey(userId), saved)
      setFetched({ userId, result: saved })
    },
    remove: async () => {
      await deleteAccountStringSetup()
      storeStringSetup(accountKey(userId), null)
      setFetched({ userId, result: null })
    },
  }
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
