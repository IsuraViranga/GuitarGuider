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
  | { kind: 'using'; guitar: DatasetGuitar }
  /** No recorded guitar fits the player's guitar (or none yet): the normal string check. */
  | { kind: 'normal' }

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

/** The first candidate guitar (ids in order) that fits the player's guitar, 'loading', or null. */
function pickGuitar(
  candidateIds: string,
  rows: Record<string, FingerprintRow[]>,
  setup: { open: Partial<Record<number, number>> } | null,
  guitars: DatasetGuitar[],
): { guitar: DatasetGuitar; match: SoundMatch } | 'loading' | null {
  for (const id of candidateIds ? candidateIds.split(',') : []) {
    const found = rows[id]
    if (found === undefined) return 'loading'
    const references: Reference[] = found.map((r) => ({ stringNumber: r.stringNumber as StringNumber, fret: r.fret, v: r.v }))
    const match = fitsSetup(references, setup) ? createSoundMatch(references) : null
    const guitar = guitars.find((g) => g.id === id)
    if (match && guitar) return { guitar, match }
  }
  return null
}

/**
 * Practice for signed-in players: compare same-sounding places with a recorded guitar's
 * recordings. The player's choice on this device is tried first, then the admin's default guitar;
 * the first whose open strings sound like the player's guitar setup (fitsSetup) is used. When none
 * fits, practice quietly uses the normal string check (no "does not match" message for the player).
 */
export function useSoundMatch(setup: { open: Partial<Record<number, number>> } | null): SoundMatchState {
  const auth = useAuth()
  const userId = auth.status === 'signedIn' && auth.user ? auth.user.id : null
  const [guitars, setGuitars] = useState<DatasetGuitar[] | null>(null)
  const [choices, setChoices] = useState<Record<string, string | null>>({})
  /** Each candidate guitar's recordings, by guitar id (an empty list when they could not be read). */
  const [rows, setRows] = useState<Record<string, FingerprintRow[]>>({})

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
  // The chosen guitar first, then the default guitar.
  const candidateIds = choice === 'off' || !guitars ? '' : [...new Set([guitars.find((g) => g.id === choice)?.id, guitars.find((g) => g.isDefault)?.id].filter(Boolean))].join(',')
  useEffect(() => {
    if (!candidateIds) return
    let current = true
    for (const id of candidateIds.split(',')) {
      getFingerprints(id)
        .then((found) => current && setRows((all) => ({ ...all, [id]: found.fingerprints })))
        .catch(() => current && setRows((all) => ({ ...all, [id]: [] })))
    }
    return () => {
      current = false
    }
  }, [candidateIds])

  const picked = useMemo(() => pickGuitar(candidateIds, rows, setup, guitars ?? []), [candidateIds, rows, setup, guitars])

  let status: SoundMatchStatus
  if (choice === 'off') status = { kind: 'off' }
  else if (guitars === null || picked === 'loading') status = { kind: 'loading' }
  else status = picked ? { kind: 'using', guitar: picked.guitar } : { kind: 'normal' }
  const match = picked && picked !== 'loading' ? picked.match : null

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
