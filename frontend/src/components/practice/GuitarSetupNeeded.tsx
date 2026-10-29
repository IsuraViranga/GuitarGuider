import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { StringSetup, StringSetupState } from '../../practice/stringSetup'
import { GuitarPick } from '../decor/GuitarPick'
import styles from './GuitarSetupNeeded.module.css'

const FACTS = [
  { icon: '🎸', text: '6 strings' },
  { icon: '👆', text: '3 plucks each' },
  { icon: '⏱', text: '30 sec' },
]

/**
 * Signed in, before the first song: the 30-second guitar setup (saved with the account), or a
 * setup already done on this phone without an account.
 */
export function GuitarSetupNeeded({ strings, songTitle }: { strings: StringSetupState; songTitle: string }) {
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const device = strings.deviceSetup
  const adoptDeviceSetup = (setup: StringSetup) => {
    setError(null)
    strings.save(setup).catch(() => setError('Could not save it to your account. Please check your connection and try again.'))
  }

  return (
    <div className={`page ${styles.page}`}>
      <section className={`card ${styles.card}`} aria-labelledby="setup-needed">
        <GuitarPick className={styles.pick} />
        <p className={styles.upNext}>
          Up next: <strong>{songTitle}</strong>
        </p>
        <h1 id="setup-needed" className={styles.title}>
          Quick guitar setup
        </h1>
        <p className={styles.lead}>So the app can tell which string you play. Just once.</p>
        <ul className={styles.facts} aria-label="What you do">
          {FACTS.map((fact) => (
            <li key={fact.text}>
              <span aria-hidden="true">{fact.icon}</span> {fact.text}
            </li>
          ))}
        </ul>
        <Link className={`button button-primary ${styles.start}`} to="/guitar-setup" state={{ from: location.pathname }}>
          Start setup <span aria-hidden="true">→</span>
        </Link>
        {device && (
          <button type="button" className={styles.alt} onClick={() => adoptDeviceSetup(device)}>
            Use this phone’s setup ({new Date(device.savedAt).toLocaleDateString()})
          </button>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <p className={styles.note}>Saved to your account · Redo it anytime from your account menu</p>
      </section>
    </div>
  )
}
