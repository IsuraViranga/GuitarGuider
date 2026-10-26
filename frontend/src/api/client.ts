// Talking to the app's server (/api on the same address: Netlify forwards it to the server).
// - Sends the "X-Requested-With: fetch" header every change needs (protection against other sites).
// - The free server sleeps when nobody uses it and takes up to a minute to wake: if a request is
//   slow, everyone listening to `onWakingChange` is told, so the app can say "Waking up the server…".
// - Errors come back as ApiError with a message written for the user.

export class ApiError extends Error {
  readonly status: number
  /** Problems per form field, e.g. { email: "Please enter a valid email address…" } */
  readonly fields: Record<string, string>

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
  }
}

/** After this long without an answer, the server is probably waking up. */
export const SLOW_REQUEST_MS = 3000
/** Give up after this long (waking takes about a minute). */
export const REQUEST_TIMEOUT_MS = 90_000

let slowRequests = 0
const wakingListeners = new Set<(waking: boolean) => void>()

/** Called with true while at least one request is slow, false when all have finished. */
export function onWakingChange(listener: (waking: boolean) => void): () => void {
  wakingListeners.add(listener)
  return () => wakingListeners.delete(listener)
}

function setSlow(change: 1 | -1) {
  const before = slowRequests > 0
  slowRequests += change
  const after = slowRequests > 0
  if (before !== after) for (const listener of wakingListeners) listener(after)
}

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown }

export async function apiRequest<T>(path: string, { method = 'GET', body }: Options = {}): Promise<T> {
  const controller = new AbortController()
  let slow = false
  const slowTimer = setTimeout(() => {
    slow = true
    setSlow(1)
  }, SLOW_REQUEST_MS)
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      // Always the latest (never an old copy from the browser cache).
      cache: 'no-store',
      headers: { 'X-Requested-With': 'fetch', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError(
      0,
      controller.signal.aborted
        ? 'The server did not answer. Please check your internet connection and try again.'
        : 'Could not reach the server. Please check your internet connection and try again.',
    )
  } finally {
    clearTimeout(slowTimer)
    clearTimeout(timeout)
    if (slow) setSlow(-1)
  }

  if (response.status === 204) return undefined as T
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' ? data.detail : null
    const fields = data && typeof data === 'object' && 'fields' in data && data.fields && typeof data.fields === 'object' ? (data.fields as Record<string, string>) : {}
    throw new ApiError(response.status, detail ?? 'Something went wrong on the server. Please try again in a moment.', fields)
  }
  return data as T
}
