import { useId, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { usePageTitle } from '../app/usePageTitle'
import avatar from '../assets/brand/melantha-avatar.jpg'
import { useAuth } from '../auth/authContext'
import { GuitarPick } from '../components/decor/GuitarPick'
import styles from './AuthPage.module.css'

type Mode = 'signin' | 'signup'
type Field = 'name' | 'email' | 'password'

const MIN_PASSWORD = 8
const BENEFITS = [
  'Keep your own song list',
  'Share a song with everyone (after the admin checks it)',
  'Save your practice and see your progress',
]

/** The same first checks the server makes, so mistakes show at once. */
function checkForm(mode: Mode, name: string, email: string, password: string): Partial<Record<Field, string>> {
  const problems: Partial<Record<Field, string>> = {}
  if (mode === 'signup' && !name.trim()) problems.name = 'Please enter your name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) problems.email = 'Please enter a valid email address, like name@example.com.'
  if (mode === 'signup' && password.length < MIN_PASSWORD) problems.password = `Please use at least ${MIN_PASSWORD} characters for your password.`
  if (mode === 'signin' && !password) problems.password = 'Please enter your password.'
  return problems
}

/** Sign in and create-account pages: a glass card on the stage, with Melantha. */
export function AuthPage({ mode }: { mode: Mode }) {
  usePageTitle(mode === 'signin' ? 'Sign in' : 'Create account')
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/songs'
  const ids = { name: useId(), email: useId(), password: useId(), passwordHelp: useId() }

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (auth.status === 'signedIn' && !busy) return <Navigate to={from} replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const problems = checkForm(mode, name, email, password)
    setFieldErrors(problems)
    if (Object.keys(problems).length > 0) {
      document.getElementById(ids[Object.keys(problems)[0] as Field])?.focus()
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') await auth.signIn(email.trim(), password)
      else await auth.signUp(name.trim(), email.trim(), password)
      navigate(from, { replace: true })
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError(0, 'Something went wrong. Please try again.')
      setFieldErrors(apiError.fields as Partial<Record<Field, string>>)
      setFormError(apiError.message)
      setBusy(false)
    }
  }

  const field = (key: Field) => ({
    id: ids[key],
    'aria-invalid': fieldErrors[key] ? true : undefined,
    'aria-describedby': [fieldErrors[key] ? `${ids[key]}-error` : '', key === 'password' && mode === 'signup' ? ids.passwordHelp : '']
      .filter(Boolean)
      .join(' ') || undefined,
  })
  const errorFor = (key: Field) =>
    fieldErrors[key] && (
      <p id={`${ids[key]}-error`} className={styles.fieldError}>
        {fieldErrors[key]}
      </p>
    )

  return (
    <div className={`page ${styles.page}`}>
      <section className={`card ${styles.card}`} aria-labelledby="auth-heading">
        <div className={styles.portrait} aria-hidden="true">
          <img src={avatar} alt="" width={96} height={96} />
        </div>
        <p className={styles.kicker}>Melantha Guitar Academy</p>
        <h1 id="auth-heading" className={styles.title}>
          {mode === 'signin' ? 'Welcome back' : 'Join the academy'}
        </h1>
        <p className={styles.lead}>
          {mode === 'signin' ? 'Sign in to your songs and practice.' : 'A free account takes a minute.'}
        </p>

        {mode === 'signup' && (
          <ul className={styles.benefits}>
            {BENEFITS.map((benefit) => (
              <li key={benefit}>
                <GuitarPick className={styles.benefitPick} />
                {benefit}
              </li>
            ))}
          </ul>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {formError && (
            <p role="alert" className="error-box">
              {formError}
              {formError.includes('already exists') && (
                <>
                  {' '}
                  <Link to="/signin" state={{ from }}>
                    Sign in
                  </Link>
                </>
              )}
            </p>
          )}

          {mode === 'signup' && (
            <div className="field">
              <label htmlFor={ids.name}>Your name</label>
              <input {...field('name')} type="text" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              {errorFor('name')}
            </div>
          )}

          <div className="field">
            <label htmlFor={ids.email}>Email</label>
            <input
              {...field('email')}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {errorFor('email')}
          </div>

          <div className="field">
            <label htmlFor={ids.password}>Password</label>
            <div className={styles.passwordRow}>
              <input
                {...field('password')}
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className={styles.showButton}
                aria-pressed={showPassword}
                aria-controls={ids.password}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {mode === 'signup' && (
              <p id={ids.passwordHelp} className="muted">
                At least {MIN_PASSWORD} characters.
              </p>
            )}
            {errorFor('password')}
          </div>

          <button type="submit" className={`button button-primary ${styles.submit}`} disabled={busy}>
            {busy ? (mode === 'signin' ? 'Signing in…' : 'Creating your account…') : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className={styles.switch}>
          {mode === 'signin' ? (
            <>
              New here? <Link to="/signup" state={{ from }}>Create a free account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to="/signin" state={{ from }}>Sign in</Link>
            </>
          )}
        </p>
        <p className={styles.guest}>
          No account needed to practise: <Link to="/songs">go to the songs</Link>.
        </p>
      </section>
    </div>
  )
}
