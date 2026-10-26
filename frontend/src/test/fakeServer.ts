import { vi } from 'vitest'

export type Call = { key: string; body: unknown }
type Route = (body: unknown) => [number, unknown?]

/**
 * A pretend API server for tests: answers "METHOD /path?query" from `routes` and records every
 * call. Unknown requests fail like a network error (as if offline).
 */
export function fakeServer(routes: Record<string, Route>): Call[] {
  const calls: Call[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ key, body })
    const route = routes[key]
    if (!route) throw new TypeError('Failed to fetch')
    const [status, data] = route(body)
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

export const USER = { id: 'u1', name: 'Isura Perera', email: 'isura@example.com', role: 'user' }
export const ADMIN = { ...USER, role: 'admin' }
export const signedInAs = (user: object) => ({ 'GET /api/auth/me': () => [200, user] as [number, unknown] })
export const signedOut = { 'GET /api/auth/me': () => [401, { detail: 'Please sign in.' }] as [number, unknown] }

const OPEN: Record<number, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 }

/** A song as the server sends it. */
export function apiSong(id: string, title: string, extra: Record<string, unknown> = {}) {
  const notes = [10, 11, 13].map((n, index) => {
    const stringNumber = Math.floor(n / 10)
    const fret = n % 10
    return { index, midi: OPEN[stringNumber] + fret, position: { stringNumber, fret } }
  })
  return {
    id,
    title,
    artist: null,
    description: null,
    difficulty: null,
    scope: 'global',
    canEdit: false,
    noteCount: notes.length,
    chordCount: 0,
    tuningId: 'standard',
    sourceText: '10 11 13',
    notes,
    ...extra,
  }
}
