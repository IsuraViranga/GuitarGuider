import { useEffect, useState } from 'react'
import styles from './HeroSlideshow.module.css'

export interface Slide {
  src: string
  alt: string
  caption: string
  /** CSS object-position, so each photo's face stays in the frame. */
  focus: string
}

const INTERVAL_MS = 6000

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Photos that cross-fade under a sweeping stage light, with a slow zoom on the one showing.
 * Auto-play can be paused (and is off with reduced motion); the dots choose a photo directly.
 */
export function HeroSlideshow({ slides }: { slides: readonly Slide[] }) {
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())

  useEffect(() => {
    if (!playing || slides.length < 2) return
    const timer = window.setInterval(() => setCurrent((i) => (i + 1) % slides.length), INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [playing, slides.length])

  return (
    <div className={styles.show}>
      <div className={styles.frame}>
        {slides.map((slide, i) => (
          <img
            key={slide.src}
            className={`${styles.photo} ${i === current ? styles.active : ''}`}
            src={slide.src}
            alt={i === current ? slide.alt : ''}
            aria-hidden={i === current ? undefined : true}
            style={{ objectPosition: slide.focus }}
          />
        ))}
        <span className={styles.beam} aria-hidden="true" />
      </div>
      <p key={current} className={styles.caption}>
        {slides[current].caption}
      </p>
      {slides.length > 1 && (
        <div className={styles.controls}>
          {slides.map((slide, i) => (
            <button
              key={slide.src}
              type="button"
              className={`${styles.dot} ${i === current ? styles.dotActive : ''}`}
              aria-label={`Show photo ${i + 1} of ${slides.length}: ${slide.caption}`}
              aria-pressed={i === current}
              onClick={() => setCurrent(i)}
            />
          ))}
          <button
            type="button"
            className={styles.pause}
            aria-label={playing ? 'Pause photos' : 'Play photos'}
            onClick={() => setPlaying((p) => !p)}
          >
            <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
