import type { CSSProperties } from 'react'
import { GuitarPick } from './GuitarPick'
import styles from './PickBurst.module.css'

/** Eight picks flying out in a circle, alternating the theme colours. */
const PICKS = Array.from({ length: 8 }, (_, i) => ({
  angle: i * 45 + 22.5,
  colour: ['#ffc35c', '#7c5cff', '#f5a524', '#3b82f6'][i % 4],
}))

/**
 * A quick burst of small guitar picks from the centre of its parent, for a correct note.
 * Give it a new `key` each time to replay it. Decorative; off with reduced motion.
 */
export function PickBurst() {
  return (
    <span className={styles.burst} aria-hidden="true" data-testid="pick-burst">
      {PICKS.map((pick) => (
        <span
          key={pick.angle}
          className={styles.pick}
          style={{ '--angle': `${pick.angle}deg`, color: pick.colour } as CSSProperties}
        >
          <GuitarPick />
        </span>
      ))}
    </span>
  )
}
