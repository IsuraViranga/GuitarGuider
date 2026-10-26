import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Pages render a little later when the machine is busy (all tests at once): wait up to 3 s.
configure({ asyncUtilTimeout: 3000 })

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
