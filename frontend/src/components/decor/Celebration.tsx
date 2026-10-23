import type { CSSProperties } from 'react'
import { GuitarPick } from './GuitarPick'
import styles from './Celebration.module.css'

/** Fixed positions/timings so every celebration looks the same (and tests are predictable). */
const PICKS = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 6) * 0.18,
  duration: 1.8 + (i % 4) * 0.35,
  size: 14 + (i % 3) * 6,
  colour: ['#ffc35c', '#f5a524', '#7c5cff', '#3b82f6'][i % 4],
}))

/** A short shower of guitar picks when a song is completed (decorative; off with reduced motion). */
export function Celebration() {
  return (
    <div className={styles.shower} aria-hidden="true" data-testid="celebration">
      {PICKS.map((pick, i) => (
        <span
          key={i}
          className={styles.pick}
          style={
            {
              left: `${pick.left}%`,
              width: pick.size,
              height: pick.size,
              color: pick.colour,
              animationDelay: `${pick.delay}s`,
              animationDuration: `${pick.duration}s`,
            } as CSSProperties
          }
        >
          <GuitarPick />
        </span>
      ))}
    </div>
  )
}
