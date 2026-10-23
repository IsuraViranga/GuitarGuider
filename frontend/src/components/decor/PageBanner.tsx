import type { ReactNode } from 'react'
import { GuitarArt } from './GuitarArt'
import styles from './PageBanner.module.css'

type PageBannerProps = {
  /** Small label above the title, e.g. "Tonight's set list". */
  kicker: string
  title: string
  children?: ReactNode
  /** Optional photo on the right (faded into the stage light). */
  photo?: { src: string; alt: string; width: number; height: number }
  headingId?: string
}

/** Stage-lit page header with a glowing guitar behind frosted glass. */
export function PageBanner({ kicker, title, children, photo, headingId }: PageBannerProps) {
  return (
    <section className={`${styles.banner} ${photo ? '' : styles.noPhoto}`} aria-labelledby={headingId}>
      <GuitarArt className={styles.bannerGuitar} />
      <div className={styles.bannerText}>
        <p className={styles.kicker}>{kicker}</p>
        <h1 id={headingId}>{title}</h1>
        {children}
      </div>
      {photo && <img className={styles.bannerPhoto} {...photo} />}
    </section>
  )
}
