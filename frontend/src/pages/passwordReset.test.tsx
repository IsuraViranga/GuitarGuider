import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeServer, signedOut, USER } from '../test/fakeServer'
import { renderApp } from '../test/renderApp'

const ANSWER = { detail: 'If an account uses this email, a link to choose a new password is on its way.' }
const BAD = { detail: 'This link has expired or was already used. Please ask for a new one.' }

describe('Forgot password', () => {
  it('Sign in links to it, keeping the email already typed', async () => {
    fakeServer(signedOut)
    renderApp('/signin')
    await userEvent.type(await screen.findByLabelText('Email'), 'isura@example.com')
    await userEvent.click(screen.getByRole('link', { name: 'Forgot password?' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Forgot password?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('isura@example.com')
  })

  it('sends the link, says where to look, and waits before sending again', async () => {
    const calls = fakeServer({ ...signedOut, 'POST /api/auth/forgot-password': () => [202, ANSWER] })
    renderApp('/forgot-password')
    await userEvent.type(await screen.findByLabelText('Email'), ' isura@example.com ')
    await userEvent.click(screen.getByRole('button', { name: 'Send me the link' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText(/If an account uses/)).toHaveTextContent('If an account uses isura@example.com, a link to choose a new password is on its way.')
    expect(screen.getByText(/Look in/)).toHaveTextContent('Spam')
    expect(screen.getByRole('button', { name: /Send again in 30 s/ })).toBeDisabled()
    expect(calls.find((c) => c.key === 'POST /api/auth/forgot-password')!.body).toEqual({ email: 'isura@example.com' })
    await userEvent.click(screen.getByRole('button', { name: 'Use another email' }))
    expect(screen.getByLabelText('Email')).toHaveValue('isura@example.com')
  })

  it('checks the email first, and shows the server’s message when email is not set up', async () => {
    const calls = fakeServer({
      ...signedOut,
      'POST /api/auth/forgot-password': () => [503, { detail: 'Password reset by email is not ready yet. Please ask the admin for help.' }],
    })
    renderApp('/forgot-password')
    await userEvent.click(await screen.findByRole('button', { name: 'Send me the link' }))
    expect(screen.getByText('Please enter a valid email address, like name@example.com.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveFocus()
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false)
    await userEvent.type(screen.getByLabelText('Email'), 'isura@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send me the link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Password reset by email is not ready yet.')
  })
})

describe('Choose a new password (the emailed link)', () => {
  it('shows whose account it is, saves the new password and signs in', async () => {
    const calls = fakeServer({
      ...signedOut,
      'POST /api/auth/reset-password/check': () => [200, { email: 'isura@example.com' }],
      'POST /api/auth/reset-password': () => [200, USER],
    })
    const { router } = renderApp('/reset-password#key-123')
    expect(await screen.findByText(/For/)).toHaveTextContent('For isura@example.com.')
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(screen.getByText('Please use at least 8 characters for your password.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('New password'), 'new-guitar-1')
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByTestId('welcome-banner')).toHaveTextContent('Your new password is saved. Welcome back, Isura Perera!')
    expect(router.state.location.pathname).toBe('/songs')
    expect(calls.find((c) => c.key === 'POST /api/auth/reset-password')!.body).toEqual({ token: 'key-123', password: 'new-guitar-1' })
  })

  it('an old or used link says so and offers a new one', async () => {
    fakeServer({ ...signedOut, 'POST /api/auth/reset-password/check': () => [410, BAD] })
    renderApp('/reset-password#old-key')
    expect(await screen.findByRole('alert')).toHaveTextContent(BAD.detail)
    expect(screen.getByRole('link', { name: 'Send me a new link' })).toHaveAttribute('href', '/forgot-password')
  })

  it('a newer link pasted in the same tab is checked again (only the "#" part changes)', async () => {
    const calls = fakeServer({
      ...signedOut,
      'POST /api/auth/reset-password/check': (body) =>
        (body as { token: string }).token === 'new-key' ? [200, { email: 'isura@example.com' }] : [410, BAD],
    })
    const { router } = renderApp('/reset-password#old-key')
    expect(await screen.findByRole('alert')).toHaveTextContent(BAD.detail)
    await act(() => router.navigate('/reset-password#new-key'))
    expect(await screen.findByText(/For/)).toHaveTextContent('For isura@example.com.')
    expect(calls.filter((c) => c.key === 'POST /api/auth/reset-password/check').map((c) => c.body)).toEqual([{ token: 'old-key' }, { token: 'new-key' }])
  })

  it('a link without its key does not ask the server', async () => {
    const calls = fakeServer(signedOut)
    renderApp('/reset-password')
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is not complete.')
    expect(calls.some((c) => c.key.includes('reset-password'))).toBe(false)
  })
})
