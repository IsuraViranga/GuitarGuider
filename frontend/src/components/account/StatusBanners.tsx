import { useEffect, useState } from 'react'
import { onWakingChange } from '../../api/client'
import { useAuth } from '../../auth/authContext'
import { GuitarPick } from '../decor/GuitarPick'
import { PickBurst } from '../decor/PickBurst'
import styles from './StatusBanners.module.css'

const WELCOME_MS = 5000

/**
 * Under the header: "Waking up the server…" while the sleeping free server starts (any request
 * slower than a few seconds), and a short "Welcome, Isura!" with a pick burst after signing in.
 */
export function StatusBanners() {
  const { welcome, dismissWelcome } = useAuth()
  const [waking, setWaking] = useState(false)

  useEffect(() => onWakingChange(setWaking), [])
  useEffect(() => {
    if (!welcome) return
    const timer = setTimeout(dismissWelcome, WELCOME_MS)
    return () => clearTimeout(timer)
  }, [welcome, dismissWelcome])

  return (
    <div className={styles.stack}>
      <div role="status" aria-live="polite" className={styles.live}>
        {waking && (
          <p className={styles.waking} data-testid="waking-banner">
            <GuitarPick className={styles.wakingPick} />
            Waking up the server… The first visit after a quiet time can take up to a minute.
          </p>
        )}
      </div>
      <div role="status" aria-live="polite" className={styles.live}>
        {welcome && (
          <p className={styles.welcome} data-testid="welcome-banner">
            <span className={styles.burst} aria-hidden="true">
              <PickBurst />
            </span>
            <span>🎸 {welcome}</span>
            <button type="button" className={styles.close} onClick={dismissWelcome} aria-label="Close message">
              ×
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
