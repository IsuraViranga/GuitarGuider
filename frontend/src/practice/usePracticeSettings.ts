import { useState } from 'react'
import type { PracticeMode } from './practiceReducer'

// Per-device practice preferences, remembered in this browser.

const ERROR_SOUND_KEY = 'guitar-practice:error-sound'
const BOOST_KEY = 'guitar-practice:mic-boost'
const MODE_KEY = 'guitar-practice:mode'
const SPEAK_KEY = 'guitar-practice:speak-notes'

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function writeBoolean(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Not saved (private mode or storage blocked); the choice still applies on this page.
  }
}

/** Whether a short sound plays for a wrong note. On by default; there is never a success sound. */
export function useErrorSoundSetting(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(() => readBoolean(ERROR_SOUND_KEY, true))
  return [
    enabled,
    (value: boolean) => {
      setEnabled(value)
      writeBoolean(ERROR_SOUND_KEY, value)
    },
  ]
}

/** Whether the next note is said aloud (spoken guidance). Off by default. */
export function useSpeakNotesSetting(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(() => readBoolean(SPEAK_KEY, false))
  return [
    enabled,
    (value: boolean) => {
      setEnabled(value)
      writeBoolean(SPEAK_KEY, value)
    },
  ]
}

/** Whether automatic microphone volume is turned on (for quiet microphones). Off by default. */
export function useMicBoostSetting(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(() => readBoolean(BOOST_KEY, false))
  return [
    enabled,
    (value: boolean) => {
      setEnabled(value)
      writeBoolean(BOOST_KEY, value)
    },
  ]
}

/** Note by note (stops on each missed note) or play through (keeps up with fast playing). */
export function usePracticeModeSetting(): [PracticeMode, (mode: PracticeMode) => void] {
  const [mode, setMode] = useState<PracticeMode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'flow' ? 'flow' : 'strict'
    } catch {
      return 'strict'
    }
  })
  return [
    mode,
    (value: PracticeMode) => {
      setMode(value)
      try {
        localStorage.setItem(MODE_KEY, value)
      } catch {
        // Not saved; still applies on this page.
      }
    },
  ]
}
