// Compares a detected pitch with the note the song expects.
// Pitches are compared as numbers (cents apart), never as note-name strings.
//
// One fret = 100 cents. A student's guitar is often a little out of tune, so a note up to
// 70 cents away still counts as the right note (with a tuning hint above 40 cents). Playing the
// wrong fret on a reasonably tuned guitar is about 100 cents away, so it is still caught.

export type MatchConfig = {
  /** Within this many cents the note is in tune. */
  inTuneCents: number
  /** Within this many cents the note is accepted as correct (with a tuning hint if not in tune). */
  acceptCents: number
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = { inTuneCents: 40, acceptCents: 70 }

export type Comparison = {
  result: 'correct' | 'wrong'
  /** False when accepted but noticeably out of tune. */
  inTune: boolean
  /** Signed distance from the target; positive = sharp (too high). */
  cents: number
  /** The nearest whole note to what was heard. */
  heardMidi: number
  /** Right note name but in another octave (e.g. E3 instead of E4). Still counts as wrong. */
  octaveOff: boolean
}

export function compareToTarget(
  detectedMidi: number,
  targetMidi: number,
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): Comparison {
  const cents = (detectedMidi - targetMidi) * 100
  const distance = Math.abs(cents)
  const result = distance <= config.acceptCents ? 'correct' : 'wrong'
  const heardMidi = result === 'correct' ? targetMidi : Math.round(detectedMidi)
  const octaveOff = result === 'wrong' && heardMidi !== targetMidi && (heardMidi - targetMidi) % 12 === 0
  return { result, inTune: distance <= config.inTuneCents, cents, heardMidi, octaveOff }
}
