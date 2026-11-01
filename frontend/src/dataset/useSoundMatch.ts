import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/authContext'
import type { StringNumber } from '../music/tuning'
import { getFingerprints, listGuitars, type DatasetGuitar, type FingerprintRow } from './datasetApi'
import { createSoundMatch, type SoundMatch } from './soundMatch'

/** This device's choice of recorded guitar to compare with (admin test). */
const CHOICE_KEY = 'guitar-practice:sound-match-guitar'

function readChoice(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY)
  } catch {
    return null
  }
}

function writeChoice(guitarId: string | null) {
  try {
    if (guitarId) localStorage.setItem(CHOICE_KEY, guitarId)
    else localStorage.removeItem(CHOICE_KEY)
  } catch {
    // Not saved (private mode or storage blocked); the choice still applies on this page.
  }
}

export type SoundMatchState = {
  /** Recorded guitars that are prepared (admins only; empty for everyone else). */
  guitars: DatasetGuitar[]
  chosenId: string | null
  choose: (guitarId: string | null) => void
  /** Comparing with the chosen guitar's recordings, or null (off, not loaded, or not an admin). */
  match: SoundMatch | null
}

/**
 * Sound match in practice (admin test): compare plucks with a recorded guitar's prepared
 * fingerprints. For anyone but an admin it does nothing and asks the server nothing.
 */
export function useSoundMatch(): SoundMatchState {
  const auth = useAuth()
  const isAdmin = auth.user?.role === 'admin'
  const [guitars, setGuitars] = useState<DatasetGuitar[]>([])
  const [chosenId, setChosenId] = useState<string | null>(readChoice)
  const [rows, setRows] = useState<{ guitarId: string; fingerprints: FingerprintRow[] } | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    let current = true
    listGuitars()
      .then((list) => current && setGuitars(list.filter((g) => g.fingerprints > 0)))
      .catch(() => current && setGuitars([]))
    return () => {
      current = false
    }
  }, [isAdmin])

  const active = isAdmin && chosenId && guitars.some((g) => g.id === chosenId) ? chosenId : null
  useEffect(() => {
    if (!active) return
    let current = true
    getFingerprints(active)
      .then((found) => current && setRows({ guitarId: active, fingerprints: found.fingerprints }))
      .catch(() => current && setRows(null))
    return () => {
      current = false
    }
  }, [active])

  const match = useMemo(
    () =>
      active && rows?.guitarId === active
        ? createSoundMatch(rows.fingerprints.map((r) => ({ stringNumber: r.stringNumber as StringNumber, fret: r.fret, v: r.v })))
        : null,
    [active, rows],
  )
  return {
    guitars: isAdmin ? guitars : [],
    chosenId: active,
    choose: (guitarId) => {
      setChosenId(guitarId)
      writeChoice(guitarId)
    },
    match,
  }
}
