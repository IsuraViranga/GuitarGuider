import { GuitarPick } from '../decor/GuitarPick'
import styles from './RatingPicks.module.css'

/** 1-3 guitar picks for how cleanly a song was played (3 = no mistakes). */
export function RatingPicks({ rating, small = false }: { rating: number; small?: boolean }) {
  return (
    <span className={`${styles.picks} ${small ? styles.small : ''}`} role="img" aria-label={`${rating} of 3 picks`}>
      {[1, 2, 3].map((n) => (
        <GuitarPick key={n} className={styles.pick} filled={n <= rating} />
      ))}
    </span>
  )
}
