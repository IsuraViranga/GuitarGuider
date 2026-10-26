// Saved practice ("My progress") on the server: one saved practice per song.

import { apiRequest, ApiError } from '../api/client'
import type { PracticeMode, StepRecord } from './practiceReducer'

export type SavedPractice = {
  songId: string
  songTitle: string
  songArtist: string | null
  songScope: 'global' | 'mine'
  mode: PracticeMode
  completed: boolean
  rightCount: number
  wrongCount: number
  bestStreak: number
  skippedCount: number
  /** 1-3 picks for a finished song, null when not finished. */
  rating: number | null
  totalSteps: number
  playedSteps: number
  savedAt: string
}

export type SavedPracticeDetail = SavedPractice & { record: StepRecord[] }

export type PracticeToSave = {
  mode: PracticeMode
  completed: boolean
  wrongCount: number
  bestStreak: number
  skippedCount: number
  record: readonly StepRecord[]
}

/** The server keeps at most this many wrong tries per step (more adds nothing to the review). */
const MAX_TRIES_PER_STEP = 50

export async function listProgress(): Promise<SavedPractice[]> {
  const { progress } = await apiRequest<{ progress: SavedPractice[] }>('/api/progress')
  return progress
}

/** The saved practice of a song, or null when there is none. */
export async function getSavedPractice(songId: string): Promise<SavedPracticeDetail | null> {
  try {
    return await apiRequest<SavedPracticeDetail>(`/api/progress/${encodeURIComponent(songId)}`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** Saves (or replaces) the practice of a song. */
export function savePractice(songId: string, practice: PracticeToSave): Promise<SavedPractice> {
  return apiRequest<SavedPractice>(`/api/progress/${encodeURIComponent(songId)}`, {
    method: 'PUT',
    body: {
      ...practice,
      record: practice.record.map((step) => ({ wrong: step.wrong.slice(0, MAX_TRIES_PER_STEP), result: step.result })),
    },
  })
}

export async function deleteSavedPractice(songId: string): Promise<void> {
  await apiRequest<void>(`/api/progress/${encodeURIComponent(songId)}`, { method: 'DELETE' })
}
