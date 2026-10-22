import { useState } from 'react'

// Per-device practice preferences, remembered in this browser.

const ERROR_SOUND_KEY = 'guitar-practice:error-sound'
const BOOST_KEY = 'guitar-practice:mic-boost'

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
