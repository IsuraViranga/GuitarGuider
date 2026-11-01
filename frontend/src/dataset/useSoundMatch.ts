import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/authContext'
import type { StringNumber } from '../music/tuning'
import { getFingerprints, listGuitars, type DatasetGuitar, type FingerprintRow } from './datasetApi'
import { createSoundMatch, fitsSetup, guitarChoiceKey, type Reference, type SoundMatch } from './soundMatch'

function readChoice(userId: string | null): string | null {
  if (!userId) return null
  try {
    return localStorage.getItem(guitarChoiceKey(userId))
  } catch {
    return null
  }
}

function writeChoice(userId: string, choice: string | null) {
  try {
    if (choice) localStorage.setItem(guitarChoiceKey(userId), choice)
    else localStorage.removeItem(guitarChoiceKey(userId))
  } catch {
    // Not saved (private mode or storage blocked); the choice still applies on this page.
  }
}

/** What the string check does with recorded guitars right now, for the player to see. */
export type SoundMatchStatus =
  | { kind: 'loading' }
  | { kind: 'off' }
  /** Nothing chosen and no default guitar. */
  | { kind: 'none' }
  | { kind: 'using'; guitar: DatasetGuitar }
  /** The guitar's open strings do not sound like the player's (guitar setup): not used. */
  | { kind: 'noFit'; guitar: DatasetGuitar }
  /** No guitar setup to compare with: not used. */
  | { kind: 'noSetup'; guitar: DatasetGuitar }

export type SoundMatchState = {
  /** Signed in (visitors get none of this, and nothing is asked from the server). */
  available: boolean
  /** Recorded guitars with recordings ready, for the choice. */
  guitars: DatasetGuitar[]
  /** '' = the default guitar, 'off', or a guitar id. */
  choice: string
  choose: (choice: string) => void
  status: SoundMatchStatus
  /** Comparing with the guitar's recordings (only when it fits the player's guitar), or null. */
  match: SoundMatch | null
}

/**
 * Practice for signed-in players: compare same-sounding places with a recorded guitar's
 * recordings. The guitar is the player's choice on this device, else the admin's default guitar;
 * it is used only when its open strings sound like the player's guitar setup (fitsSetup).
 */
export function useSoundMatch(setup: { open: Partial<Record<number, number>> } | null): SoundMatchState {
  const auth = useAuth()
  const userId = auth.status === 'signedIn' && auth.user ? auth.user.id : null
  const [guitars, setGuitars] = useState<DatasetGuitar[] | null>(null)
  const [choices, setChoices] = useState<Record<string, string | null>>({})
  const [rows, setRows] = useState<{ guitarId: string; fingerprints: FingerprintRow[] } | null>(null)

  useEffect(() => {
    if (!userId) return
    let current = true
    listGuitars()
      .then((list) => current && setGuitars(list.filter((g) => g.fingerprints > 0)))
      .catch(() => current && setGuitars([]))
    return () => {
      current = false
    }
  }, [userId])

  const choice = userId ? ((userId in choices ? choices[userId] : readChoice(userId)) ?? '') : ''
  const chosen = choice === 'off' ? null : (guitars?.find((g) => g.id === choice) ?? guitars?.find((g) => g.isDefault) ?? null)
  const chosenId = chosen?.id ?? null
  useEffect(() => {
    if (!chosenId) return
    let current = true
    getFingerprints(chosenId)
      .then((found) => current && setRows({ guitarId: chosenId, fingerprints: found.fingerprints }))
      .catch(() => current && setRows(null))
    return () => {
      current = false
    }
  }, [chosenId])

  const references = useMemo<Reference[] | null>(
    () => (chosen && rows?.guitarId === chosen.id ? rows.fingerprints.map((r) => ({ stringNumber: r.stringNumber as StringNumber, fret: r.fret, v: r.v })) : null),
    [chosen, rows],
  )
  const fits = references !== null && fitsSetup(references, setup)
  const match = useMemo(() => (references && fits ? createSoundMatch(references) : null), [references, fits])

  let status: SoundMatchStatus
  if (choice === 'off') status = { kind: 'off' }
  else if (guitars === null || (chosen && references === null)) status = { kind: 'loading' }
  else if (!chosen) status = { kind: 'none' }
  else if (!setup) status = { kind: 'noSetup', guitar: chosen }
  else status = fits && match ? { kind: 'using', guitar: chosen } : { kind: 'noFit', guitar: chosen }

  return {
    available: userId !== null,
    guitars: guitars ?? [],
    choice,
    choose: (next) => {
      if (!userId) return
      setChoices((all) => ({ ...all, [userId]: next || null }))
      writeChoice(userId, next || null)
    },
    status,
    match: userId ? match : null,
  }
}
