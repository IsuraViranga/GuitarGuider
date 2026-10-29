// The guitar setup on the server, kept with the student's account (one per account).

import { apiRequest, ApiError } from '../api/client'
import type { StringSetup } from './stringSetup'

/** The account's setup, or null when the student has not done one yet. */
export async function getAccountStringSetup(): Promise<StringSetup | null> {
  try {
    return await apiRequest<StringSetup>('/api/string-setup')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** Saves (or replaces) the account's setup. */
export function saveAccountStringSetup(setup: StringSetup): Promise<StringSetup> {
  return apiRequest<StringSetup>('/api/string-setup', { method: 'PUT', body: { open: setup.open, misfit: setup.misfit ?? {} } })
}
