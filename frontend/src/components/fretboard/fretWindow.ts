/** Frets visible at once; small enough to stay readable on a phone. */
export const FRETS_SHOWN = 7

/** First fret shown so the target is always visible. Frets 0–6 show the nut and open strings. */
export function firstVisibleFret(fret: number, maxFret: number): number {
  if (fret < FRETS_SHOWN) return 1
  return Math.max(1, Math.min(fret - 3, maxFret - FRETS_SHOWN + 1))
}
