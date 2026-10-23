import styles from './LevelBars.module.css'

/** Relative bar heights, so the bars look like a little mixing-desk meter rather than one block. */
const SHAPE = [0.55, 0.9, 1, 0.75, 0.6]

/** Loudness as 0–1 on a decibel scale (-80 dB silent … -10 dB very loud). */
function levelFraction(rms: number): number {
  const decibels = 20 * Math.log10(Math.max(rms, 1e-6))
  return Math.min(1, Math.max(0, (decibels + 80) / 70))
}

/** Small animated sound-level bars that move with what the microphone hears (decorative). */
export function LevelBars({ rms }: { rms: number }) {
  const level = levelFraction(rms)
  return (
    <span className={styles.bars} aria-hidden="true">
      {SHAPE.map((shape, i) => (
        <span key={i} className={styles.bar} style={{ transform: `scaleY(${Math.max(0.12, level * shape)})` }} />
      ))}
    </span>
  )
}
