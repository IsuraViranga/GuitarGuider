import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// No server in unit tests: by default the app is "not signed in" and otherwise offline, so songs
// come from the copy on the phone (the built-in songs). A test can replace this with its own
// vi.spyOn(globalThis, 'fetch') answers.
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === '/api/auth/me') {
      return new Response(JSON.stringify({ detail: 'Please sign in.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    throw new TypeError('Failed to fetch')
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})
