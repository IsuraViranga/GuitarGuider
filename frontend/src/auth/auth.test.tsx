import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { onWakingChange } from '../api/client'
import { renderApp } from '../test/renderApp'
import { initials } from './authContext'

type Call = { path: string; method: string; body: unknown; headers: Record<string, string> }

/** A tiny pretend server: answers by "METHOD /path", and records every call. */
function fakeServer(routes: Record<string, (body: unknown) => [number, unknown?]>) {
  const calls: Call[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, method, body, headers: init?.headers as Record<string, string> })
    const route = routes[`${method} ${path}`]
    const [status, data] = route ? route(body) : [404, { detail: 'Not found' }]
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const ISURA = { id: '1', name: 'Isura Perera', email: 'isura@example.com', role: 'user' }
const signedOut = { 'GET /api/auth/me': () => [401, { detail: 'Please sign in.' }] as [number, unknown] }

describe('accounts', () => {
  it('shows "Sign in" in the header when signed out, which opens the sign-in page', async () => {
    fakeServer(signedOut)
    renderApp('/songs')
    await userEvent.click(await screen.findByRole('link', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument()
  })

  it('creates an account: sends name, email and password, then shows the initials and a welcome', async () => {
    const calls = fakeServer({ ...signedOut, 'POST /api/auth/signup': () => [201, ISURA] })
    const { router } = renderApp('/signup')
    await screen.findByRole('heading', { level: 1, name: 'Join the academy' })
    await userEvent.type(screen.getByLabelText('Your name'), 'Isura Perera')
    await userEvent.type(screen.getByLabelText('Email'), 'isura@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'guitar-123')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('button', { name: 'Account: Isura Perera' })).toHaveTextContent('IP')
    expect(screen.getByTestId('welcome-banner')).toHaveTextContent('Welcome to the academy, Isura Perera!')
    expect(router.state.location.pathname).toBe('/songs')
    const signup = calls.find((c) => c.path === '/api/auth/signup')!
    expect(signup.body).toEqual({ name: 'Isura Perera', email: 'isura@example.com', password: 'guitar-123' })
    expect(signup.headers['X-Requested-With']).toBe('fetch')
  })

  it('checks the form at once, before asking the server', async () => {
    const calls = fakeServer(signedOut)
    renderApp('/signup')
    await userEvent.click(await screen.findByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Please enter your name.')).toBeInTheDocument()
    expect(screen.getByText('Please enter a valid email address, like name@example.com.')).toBeInTheDocument()
    expect(screen.getByText('Please use at least 8 characters for your password.')).toBeInTheDocument()
    expect(screen.getByLabelText('Your name')).toHaveFocus()
    expect(screen.getByLabelText('Your name')).toHaveAttribute('aria-invalid', 'true')
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('an email that already has an account: says so and offers Sign in', async () => {
    fakeServer({ ...signedOut, 'POST /api/auth/signup': () => [409, { detail: 'An account with this email already exists. Please sign in instead.' }] })
    renderApp('/signup')
    await userEvent.type(await screen.findByLabelText('Your name'), 'Isura')
    await userEvent.type(screen.getByLabelText('Email'), 'isura@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'guitar-123')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('An account with this email already exists.')
    expect(within(alert).getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows the server\'s message next to the right field', async () => {
    fakeServer({
      ...signedOut,
      'POST /api/auth/signup': () => [422, { detail: 'Please enter a valid email address, like name@example.com.', fields: { email: 'Please enter a valid email address, like name@example.com.' } }],
    })
    renderApp('/signup')
    await userEvent.type(await screen.findByLabelText('Your name'), 'Isura')
    await userEvent.type(screen.getByLabelText('Email'), 'isura@example.c')
    await userEvent.type(screen.getByLabelText('Password'), 'guitar-123')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('a wrong password keeps you on the page with a clear message', async () => {
    fakeServer({ ...signedOut, 'POST /api/auth/signin': () => [401, { detail: 'Email or password is incorrect.' }] })
    renderApp('/signin')
    await userEvent.type(await screen.findByLabelText('Email'), 'isura@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'nope-nope')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument()
  })

  it('the password can be shown and hidden', async () => {
    fakeServer(signedOut)
    renderApp('/signin')
    const password = await screen.findByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(password).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('signing in returns to the page you came from', async () => {
    fakeServer({ ...signedOut, 'POST /api/auth/signin': () => [200, ISURA] })
    const { router } = renderApp('/import')
    await userEvent.click(await screen.findByRole('link', { name: 'Sign in' }))
    await userEvent.type(await screen.findByLabelText('Email'), 'isura@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'guitar-123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('button', { name: 'Account: Isura Perera' })
    expect(router.state.location.pathname).toBe('/import')
    expect(screen.getByTestId('welcome-banner')).toHaveTextContent('Welcome back, Isura Perera!')
  })

  it('signed in: the account button shows name and email, an Admin badge for admins, and signs out', async () => {
    const calls = fakeServer({ 'GET /api/auth/me': () => [200, { ...ISURA, role: 'admin' }], 'POST /api/auth/signout': () => [204] })
    renderApp('/songs')
    await userEvent.click(await screen.findByRole('button', { name: 'Account: Isura Perera' }))
    expect(screen.getByText('isura@example.com')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/auth/signout' && c.method === 'POST')).toBe(true)
  })

  it('practice works without an account even when the server cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    renderApp('/songs/sample-first-frets/practice')
    expect(await screen.findByTestId('expected-number')).toHaveTextContent('10')
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('says "Waking up the server…" while a request is slow', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let answer: (value: Response) => void = () => {}
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => (answer = resolve)))
      const changes: boolean[] = []
      const stop = onWakingChange((waking) => changes.push(waking))
      renderApp('/songs')
      await act(async () => {
        vi.advanceTimersByTime(3500)
      })
      expect(await screen.findByTestId('waking-banner')).toHaveTextContent('Waking up the server…')
      await act(async () => answer(new Response(JSON.stringify({ detail: 'Please sign in.' }), { status: 401 })))
      expect(screen.queryByTestId('waking-banner')).not.toBeInTheDocument()
      expect(changes).toEqual([true, false])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('makes initials from a name, also in Sinhala', () => {
    expect(initials('Isura Perera')).toBe('IP')
    expect(initials('Melantha')).toBe('M')
    expect(initials('  ඉසුරු  විරංග  පෙරේරා ')).toBe('ඉපෙ')
  })
})
