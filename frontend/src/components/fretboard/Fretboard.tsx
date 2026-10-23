import { useId } from 'react'
import type { GuitarPosition } from '../../music/guitarNumber'
import { describePosition } from '../../music/guitarNumber'
import { midiToNoteName } from '../../music/pitch'
import { STRING_NUMBERS, type Tuning } from '../../music/tuning'
import { FRETS_SHOWN, firstVisibleFret } from './fretWindow'
import styles from './Fretboard.module.css'

const STRING_LABEL_X = 16
const OPEN_X = 44
const NUT_X = 70
const FRET_WIDTH = 52
const NOTE_LABEL_GAP = 22
const TOP = 22
const STRING_GAP = 28
const MARKER_RADIUS = 13
const SINGLE_INLAYS = new Set([3, 5, 7, 9, 15, 17, 19, 21])
const DOUBLE_INLAYS = new Set([12, 24])

type FretboardProps = {
  /** Where to play: one position for a note, several for a chord. Empty when unknown. */
  positions: readonly GuitarPosition[]
  tuning: Tuning
  /** Set for chords: strings that are not part of the chord are marked "do not play". */
  chord?: { name?: string }
}

/** Plain-language description for the caption and screen readers. */
function describe(positions: readonly GuitarPosition[], chord: FretboardProps['chord']): string {
  if (positions.length === 0) return 'No position set for this note.'
  if (!chord) {
    const [position] = positions
    return `Play ${describePosition(position)}${position.fret === 0 ? ' (no finger on the string)' : ''}.`
  }
  const played = [...positions].sort((a, b) => b.stringNumber - a.stringNumber)
  const parts = played.map((p) => (p.fret === 0 ? `string ${p.stringNumber} open` : `string ${p.stringNumber} fret ${p.fret}`))
  const muted = STRING_NUMBERS.filter((s) => !positions.some((p) => p.stringNumber === s))
  const skip = muted.length ? ` Do not play string${muted.length > 1 ? 's' : ''} ${muted.join(' and ')}.` : ''
  return `Strum ${chord.name ?? 'this chord'}: ${parts.join(', ')}.${skip}`
}

/**
 * Simplified fretboard showing where the song intends the note or chord to be played.
 * String 1 (thinnest) is drawn at the top, matching tab notation.
 * It shows the intended position only; it does not know where the player's fingers are.
 */
export function Fretboard({ positions, tuning, chord }: FretboardProps) {
  const captionId = useId()
  const highestFret = positions.reduce((max, p) => Math.max(max, p.fret), 0)
  const firstFret = firstVisibleFret(highestFret, tuning.maxFret)
  const showsNut = firstFret === 1
  const lastFret = firstFret + FRETS_SHOWN - 1
  const targetStrings = new Set(positions.map((p) => p.stringNumber))
  const targetFrets = new Set(positions.map((p) => p.fret))

  const stringY = (stringNumber: number) => TOP + (stringNumber - 1) * STRING_GAP
  const fretCenterX = (fret: number) => NUT_X + (fret - firstFret + 0.5) * FRET_WIDTH
  const boardRight = NUT_X + FRETS_SHOWN * FRET_WIDTH
  const width = boardRight + NOTE_LABEL_GAP + 12
  const bottom = stringY(6)
  const height = bottom + 44
  const markerX = showsNut ? OPEN_X : NUT_X - 26

  return (
    <figure className={styles.figure}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={captionId}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect className={styles.wood} x={NUT_X} y={TOP - 10} width={boardRight - NUT_X} height={bottom - TOP + 20} />

        {Array.from({ length: FRETS_SHOWN }, (_, i) => firstFret + i).map((fret) => {
          const x = fretCenterX(fret)
          const midY = (stringY(3) + stringY(4)) / 2
          return (
            <g key={fret}>
              {SINGLE_INLAYS.has(fret) && <circle className={styles.inlay} cx={x} cy={midY} r={6} />}
              {DOUBLE_INLAYS.has(fret) && (
                <>
                  <circle className={styles.inlay} cx={x} cy={(stringY(2) + stringY(3)) / 2} r={6} />
                  <circle className={styles.inlay} cx={x} cy={(stringY(4) + stringY(5)) / 2} r={6} />
                </>
              )}
              <text className={`${styles.fretNumber} ${targetFrets.has(fret) ? styles.targetText : ''}`} x={x} y={bottom + 34}>
                {fret}
              </text>
            </g>
          )
        })}

        {Array.from({ length: FRETS_SHOWN + 1 }, (_, i) => (
          <line
            key={i}
            className={i === 0 && showsNut ? styles.nut : styles.fretWire}
            x1={NUT_X + i * FRET_WIDTH}
            x2={NUT_X + i * FRET_WIDTH}
            y1={TOP - 10}
            y2={bottom + 10}
          />
        ))}

        {STRING_NUMBERS.map((stringNumber) => {
          const y = stringY(stringNumber)
          const isTarget = targetStrings.has(stringNumber)
          return (
            <g key={stringNumber}>
              <text className={`${styles.stringLabel} ${isTarget ? styles.targetText : ''}`} x={STRING_LABEL_X} y={y}>
                {stringNumber}
              </text>
              <line
                className={`${isTarget ? styles.targetString : styles.string} ${stringNumber >= 4 ? styles.wound : ''}`}
                x1={showsNut ? OPEN_X - 14 : NUT_X}
                x2={boardRight}
                y1={y}
                y2={y}
                strokeWidth={isTarget ? 3 + stringNumber * 0.4 : 1 + stringNumber * 0.4}
              />
              <text className={styles.openNote} x={boardRight + NOTE_LABEL_GAP} y={y}>
                {midiToNoteName(tuning.openStringMidi[stringNumber]).pitchClass}
              </text>
              {chord && !isTarget && (
                <text className={styles.mutedMark} x={markerX} y={y} data-testid="fretboard-muted">
                  ✕
                </text>
              )}
            </g>
          )
        })}

        {showsNut && (
          <text className={styles.fretNumber} x={OPEN_X} y={bottom + 34}>
            open
          </text>
        )}

        {positions.map((position) =>
          position.fret === 0 ? (
            showsNut && (
              <g key={position.stringNumber} data-testid="fretboard-marker" data-kind="open">
                <circle className={styles.openMarker} cx={OPEN_X} cy={stringY(position.stringNumber)} r={MARKER_RADIUS} />
                <text className={styles.openMarkerText} x={OPEN_X} y={stringY(position.stringNumber)}>
                  0
                </text>
              </g>
            )
          ) : (
            position.fret <= lastFret && (
              <g key={position.stringNumber} data-testid="fretboard-marker" data-kind="fretted">
                <circle className={styles.marker} cx={fretCenterX(position.fret)} cy={stringY(position.stringNumber)} r={MARKER_RADIUS} />
                <text className={styles.markerText} x={fretCenterX(position.fret)} y={stringY(position.stringNumber)}>
                  {position.fret}
                </text>
              </g>
            )
          ),
        )}
      </svg>
      <figcaption id={captionId} className={styles.caption}>
        {describe(positions, chord)}
        {!showsNut && <span className="muted"> Showing frets {firstFret}–{lastFret}.</span>}
      </figcaption>
    </figure>
  )
}
