import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { initials, useAuth } from '../../auth/authContext'
import styles from './AccountButton.module.css'

/** Header: "Sign in" when signed out; the user's initials (opening name, email, Sign out) when signed in. */
export function AccountButton() {
  const auth = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close on navigation, Escape, or a tap outside.
  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  if (auth.status === 'loading') return <span className={styles.placeholder} aria-hidden="true" />

  if (auth.status === 'signedOut' || !auth.user) {
    const onAuthPage = ['/signin', '/signup', '/forgot-password', '/reset-password'].includes(location.pathname)
    return (
      <Link
        to="/signin"
        state={onAuthPage ? undefined : { from: location.pathname }}
        className={styles.signIn}
        aria-current={location.pathname === '/signin' ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.personIcon}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
        </svg>
        <span className={styles.signInText}>Sign in</span>
      </Link>
    )
  }

  const { user } = auth
  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.avatar}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account: ${user.name}`}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        {initials(user.name)}
      </button>
      {open && (
        <div id={panelId} className={styles.panel}>
          <p className={styles.name}>
            {user.name}
            {user.role === 'admin' && <span className={styles.adminBadge}>Admin</span>}
          </p>
          <p className={styles.email}>{user.email}</p>
          <nav className={styles.links} aria-label="Your account">
            <Link to="/songs?list=mine" className={styles.link}>
              <span aria-hidden="true">🎸</span> My songs
            </Link>
            <Link to="/progress" className={styles.link}>
              <span aria-hidden="true">📈</span> My progress
            </Link>
            {/* After new strings, retuning or on another guitar ("Back to the song" returns here). */}
            <Link to="/guitar-setup" state={{ from: location.pathname }} className={styles.link}>
              <span aria-hidden="true">🎵</span> Redo guitar setup
            </Link>
          </nav>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <button
            type="button"
            className={`button ${styles.signOut}`}
            onClick={async () => {
              setError(null)
              try {
                await auth.signOut()
              } catch (problem) {
                setError(problem instanceof Error ? problem.message : 'Could not sign out. Please try again.')
              }
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
