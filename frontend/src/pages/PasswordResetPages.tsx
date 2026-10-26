import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { apiRequest, ApiError } from '../api/client'
import { usePageTitle } from '../app/usePageTitle'
import { useAuth } from '../auth/authContext'
import { GuitarPick } from '../components/decor/GuitarPick'
import styles from './AuthPage.module.css'

const MIN_PASSWORD = 8
/** Wait before "Send again", so a slow email is not sent three times. */
const RESEND_SECONDS = 30

const problemText = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Please try again.')

/** "Forgot password?": asks for the email and sends a link to choose a new password. */
export function ForgotPasswordPage() {
  usePageTitle('Forgot password')
  const location = useLocation()
  const emailId = useId()
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  async function send(event?: FormEvent) {
    event?.preventDefault()
    setFormError(null)
    const address = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setFieldError('Please enter a valid email address, like name@example.com.')
      document.getElementById(emailId)?.focus()
      return
    }
    setFieldError(null)
    setBusy(true)
    try {
      await apiRequest('/api/auth/forgot-password', { method: 'POST', body: { email: address } })
      setSentTo(address)
      setWait(RESEND_SECONDS)
    } catch (error) {
      setFormError(problemText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`page ${styles.page}`}>
      <section className={`card ${styles.card}`} aria-labelledby="auth-heading">
        <p className={styles.kicker}>Melantha Guitar Academy</p>
        {sentTo ? (
          <>
            <div className={styles.sentIcon} aria-hidden="true">
              ✉️
            </div>
            <h1 id="auth-heading" className={styles.title}>
              Check your email
            </h1>
            <p className={styles.lead} role="status">
              If an account uses <strong className={styles.sentEmail}>{sentTo}</strong>, a link to choose a new password is on
              its way.
            </p>
            <ul className={styles.tips}>
              <li>
                <GuitarPick className={styles.benefitPick} />
                <span>Open the link on this phone or computer. It works once, for 30 minutes.</span>
              </li>
              <li>
                <GuitarPick className={styles.benefitPick} />
                <span>
                  Not there after a minute? Look in <strong>Spam</strong> or <strong>Promotions</strong>.
                </span>
              </li>
            </ul>
            {formError && (
              <p role="alert" className="error-box">
                {formError}
              </p>
            )}
            <div className={styles.actions}>
              <button type="button" className="button" onClick={() => send()} disabled={busy || wait > 0}>
                {busy ? 'Sending…' : wait > 0 ? `Send again in ${wait} s` : 'Send again'}
              </button>
              <button type="button" className="button" onClick={() => setSentTo(null)}>
                Use another email
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 id="auth-heading" className={styles.title}>
              Forgot password?
            </h1>
            <p className={styles.lead}>No problem. Enter your account’s email and we’ll send you a link to choose a new one.</p>
            <form className={styles.form} onSubmit={send} noValidate>
              {formError && (
                <p role="alert" className="error-box">
                  {formError}
                </p>
              )}
              <div className="field">
                <label htmlFor={emailId}>Email</label>
                <input
                  id={emailId}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${emailId}-error` : undefined}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {fieldError && (
                  <p id={`${emailId}-error`} className={styles.fieldError}>
                    {fieldError}
                  </p>
                )}
              </div>
              <button type="submit" className={`button button-primary ${styles.submit}`} disabled={busy}>
                {busy ? 'Sending…' : 'Send me the link'}
              </button>
            </form>
          </>
        )}
        <p className={styles.switch}>
          Remembered it? <Link to="/signin">Sign in</Link>
        </p>
      </section>
    </div>
  )
}

type LinkState = { status: 'checking' } | { status: 'ok'; email: string } | { status: 'bad'; message: string }

/** The emailed link (/reset-password#key): choose a new password, then you are signed in. */
export function ResetPasswordPage() {
  usePageTitle('Choose a new password')
  // The key is after "#", so it is never sent to the website's server logs or to other sites. A
  // newer link pasted in the same tab changes only the "#" part: the form then starts afresh.
  const token = useLocation().hash.replace(/^#/, '')
  return <ResetPasswordForm key={token} token={token} />
}

const INCOMPLETE = 'This link is not complete. Please open the whole link from the email, or ask for a new one.'

function ResetPasswordForm({ token }: { token: string }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const passwordId = useId()
  const [link, setLink] = useState<LinkState>(token ? { status: 'checking' } : { status: 'bad', message: INCOMPLETE })
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    apiRequest<{ email: string }>('/api/auth/reset-password/check', { method: 'POST', body: { token } }).then(
      ({ email }) => !cancelled && setLink({ status: 'ok', email }),
      (error: unknown) => !cancelled && setLink({ status: 'bad', message: problemText(error) }),
    )
    return () => {
      cancelled = true
    }
  }, [token])

  async function save(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (password.length < MIN_PASSWORD) {
      setFieldError(`Please use at least ${MIN_PASSWORD} characters for your password.`)
      document.getElementById(passwordId)?.focus()
      return
    }
    setFieldError(null)
    setBusy(true)
    try {
      await auth.resetPassword(token, password)
      navigate('/songs', { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) setLink({ status: 'bad', message: error.message })
      else {
        setFieldError(error instanceof ApiError ? (error.fields.password ?? null) : null)
        setFormError(problemText(error))
      }
      setBusy(false)
    }
  }

  return (
    <div className={`page ${styles.page}`}>
      <section className={`card ${styles.card}`} aria-labelledby="auth-heading">
        <p className={styles.kicker}>Melantha Guitar Academy</p>
        {link.status === 'checking' && (
          <>
            <h1 id="auth-heading" className={styles.title}>
              Choose a new password
            </h1>
            <p className={styles.lead} role="status">
              Checking your link…
            </p>
          </>
        )}

        {link.status === 'bad' && (
          <>
            <div className={styles.sentIcon} aria-hidden="true">
              ⏳
            </div>
            <h1 id="auth-heading" className={styles.title}>
              Link not working
            </h1>
            <p role="alert" className="error-box">
              {link.message}
            </p>
            <div className={styles.actions}>
              <Link className={`button button-primary ${styles.submit}`} to="/forgot-password">
                Send me a new link
              </Link>
            </div>
          </>
        )}

        {link.status === 'ok' && (
          <>
            <h1 id="auth-heading" className={styles.title}>
              Choose a new password
            </h1>
            <p className={styles.lead}>
              For <strong className={styles.sentEmail}>{link.email}</strong>. You’ll be signed in right after.
            </p>
            <form className={styles.form} onSubmit={save} noValidate>
              {formError && (
                <p role="alert" className="error-box">
                  {formError}
                </p>
              )}
              {/* Lets the browser's password manager save the new password for this account. */}
              <input type="email" autoComplete="username" value={link.email} readOnly hidden />
              <div className="field">
                <label htmlFor={passwordId}>New password</label>
                <div className={styles.passwordRow}>
                  <input
                    id={passwordId}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    aria-invalid={fieldError ? true : undefined}
                    aria-describedby={`${passwordId}-help${fieldError ? ` ${passwordId}-error` : ''}`}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.showButton}
                    aria-pressed={showPassword}
                    aria-controls={passwordId}
                    onClick={() => setShowPassword((shown) => !shown)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p id={`${passwordId}-help`} className="muted">
                  At least {MIN_PASSWORD} characters. You’ll be signed out on your other phones and computers.
                </p>
                {fieldError && (
                  <p id={`${passwordId}-error`} className={styles.fieldError}>
                    {fieldError}
                  </p>
                )}
              </div>
              <button type="submit" className={`button button-primary ${styles.submit}`} disabled={busy}>
                {busy ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
