import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// No server in unit tests: by default every API call answers "not signed in".
// A test can replace this with its own vi.spyOn(globalThis, 'fetch') answers.
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ detail: 'Please sign in.' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
  )
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})
