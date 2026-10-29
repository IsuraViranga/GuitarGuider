import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DetectedEvent } from '../audio/pitchTracker'
import type { Stiffness } from '../audio/stringCheck'
import type { ListeningState } from '../audio/useListening'
import { renderApp } from '../test/renderApp'
import { fakeServer, signedInAs, USER } from '../test/fakeServer'

// A pretend microphone: the test plays notes by sending the events the detector would send.
const mic = vi.hoisted(() => ({
  send: null as ((events: DetectedEvent[]) => void) | null,
  probes: [] as (number | null)[],
}))
vi.mock('../audio/useListening', async () => {
  const { useState } = await import('react')
  const nothing = () => {}
  const setStiffnessProbe = (midi: number | null) => mic.probes.push(midi)
  return {
    useListening: (onNoteEvents: (events: DetectedEvent[]) => void): ListeningState => {
      const [status, setStatus] = useState<ListeningState['status']>('idle')
      mic.send = onNoteEvents
      return {
        status,
        error: null,
        autoStopped: false,
        reading: null,
        stats: null,
        start: () => setStatus('listening'),
        startFromFile: nothing,
        stop: () => setStatus('idle'),
        recording: false,
        startRecording: () => false,
        stopRecording: () => null,
        logEvent: nothing,
        resetNotes: nothing,
        setTargets: nothing,
        setChordTargets: nothing,
        setStiffnessProbe,
        playErrorSound: () => false,
        setSpeaking: nothing,
      }
    },
  }
})

let noteId = 1
/** One pluck: the open string asked for comes with its stiffness; any other note without. */
const pluck = (midi: number, stiffness?: Stiffness | null) =>
  act(() => mic.send!([{ type: 'noteStart', noteId: noteId++, midi, time: 0, ...(stiffness !== undefined ? { stiffness } : {}) }]))
const clean = (b: number): Stiffness => ({ b, overtones: 25, misfit: 0.3 })
const saveSetup = (open: Record<number, number>) =>
  localStorage.setItem('guitar-practice:string-setup', JSON.stringify({ open, savedAt: '2026-10-27T10:00:00.000Z' }))

describe('string check on the practice card', () => {
  it('without a guitar setup: explains the same sound and offers the setup', async () => {
    renderApp('/songs/sample-first-frets/practice') // 10 11 13 ...
    const hint = await screen.findByTestId('same-pitch')
    expect(hint).toHaveTextContent('25 and 39 sound the same. The app hears the note, not the string, so play it on string 1 as shown.')
    await userEvent.click(screen.getByRole('link', { name: 'Set up the string check (30 s)' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Guitar setup' })).toBeInTheDocument()
  })

  it('after the setup: says the string is checked, and listens for the string of that note', async () => {
    saveSetup({ 1: 1.7e-5, 2: 4.5e-5 })
    renderApp('/songs/sample-first-frets/practice')
    expect(await screen.findByTestId('same-pitch')).toHaveTextContent('The string check listens for the string, so play it on string 1 as shown.')
    expect(mic.probes.at(-1)).toBe(64) // 10 = E4
  })

  it('strings the setup cannot tell apart: as before, and says why', async () => {
    saveSetup({ 1: 1.7e-5 }) // string 2 was skipped
    renderApp('/songs/sample-first-frets/practice')
    expect(await screen.findByTestId('same-pitch')).toHaveTextContent('Your guitar setup cannot check these strings')
    expect(mic.probes.at(-1)).toBeNull()
  })

  it('25 played for 10: right note, wrong string', async () => {
    saveSetup({ 1: 1.7e-5, 2: 4.5e-5 })
    renderApp('/songs/sample-first-frets/practice')
    await screen.findByTestId('same-pitch')
    act(() =>
      mic.send!([
        { type: 'noteStart', noteId: 900, midi: 64, time: 0, stiffness: clean(7.7e-5) },
        { type: 'noteConfirmed', noteId: 900, midi: 64, time: 0, stiffness: clean(7.7e-5) },
      ]),
    )
    expect(screen.getByTestId('feedback')).toHaveTextContent('Right note, wrong string. That sounded like 25 (string 2, fret 5). Play 10 on string 1, open.')
    expect(screen.getByTestId('expected-number')).toHaveTextContent('10')
    // Now on string 1: correct, on to 11.
    act(() => mic.send!([{ type: 'noteStart', noteId: 901, midi: 64, time: 0, stiffness: clean(1.8e-5) }]))
    expect(screen.getByTestId('feedback')).toHaveTextContent('Correct note!')
    expect(screen.getByTestId('expected-number')).toHaveTextContent('11')
  })
})

describe('guitar setup page', () => {
  it('learns each open string from 3 clear plucks, then saves and sums up', async () => {
    renderApp('/guitar-setup')
    await userEvent.click(await screen.findByRole('button', { name: /Start/ }))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Pluck string 1 open (E4, the thinnest)')
    expect(mic.probes.at(-1)).toBe(64)

    pluck(67) // G4: not the open string
    expect(screen.getByTestId('setup-message')).toHaveTextContent('That was G4. Pluck string 1 open (E4). Is it tuned?')
    pluck(64, clean(1.7e-5))
    pluck(64, { b: 6e-5, overtones: 22, misfit: 4 }) // disturbed: not counted
    expect(screen.getByTestId('setup-message')).toHaveTextContent('That one was not clear')
    expect(screen.getByTestId('setup-picks')).toHaveAccessibleName('1 of 3 plucks')
    pluck(64, clean(1.75e-5))
    pluck(64, clean(1.68e-5))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Pluck string 2 open (B3)')
    expect(screen.getByText('String 1 · E4').closest('li')).toHaveAttribute('data-status', 'kept')

    for (const b of [4.5e-5, 4.4e-5, 4.6e-5]) pluck(59, clean(b))
    for (const b of [2.9e-5, 3e-5, 2.8e-5]) pluck(55, clean(b))
    for (let i = 0; i < 3; i++) await userEvent.click(screen.getByRole('button', { name: 'Skip this string' }))

    const result = await screen.findByTestId('setup-result')
    expect(result).toHaveTextContent('Your guitar is set up!')
    expect(result).toHaveTextContent('Strings 1 and 2: the app can tell which one you play.')
    expect(result).toHaveTextContent('Strings 2 and 3: they sound too alike on your guitar, so these are not checked.')
    expect(result).toHaveTextContent('Strings 3 and 4: not checked (a string was skipped).')
    expect(JSON.parse(localStorage.getItem('guitar-practice:string-setup')!).open).toEqual({ 1: 1.7e-5, 2: 4.5e-5, 3: 2.9e-5 })
  })

  it('a string that never sounds clear is left out instead of blocking the setup', async () => {
    renderApp('/guitar-setup')
    await userEvent.click(await screen.findByRole('button', { name: /Start/ }))
    for (let i = 0; i < 8; i++) pluck(64, null)
    expect(screen.getByTestId('setup-message')).toHaveTextContent('did not sound clear enough to measure')
    expect(screen.getByText('String 1 · E4').closest('li')).toHaveAttribute('data-status', 'left')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Pluck string 2 open')
  })

  it('shows a saved setup and can remove it', async () => {
    saveSetup({ 1: 1.7e-5, 2: 4.5e-5 })
    renderApp('/guitar-setup')
    expect(await screen.findByText(/Your guitar was set up on/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete my setup' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(localStorage.getItem('guitar-practice:string-setup')).toBeNull()
    expect(screen.queryByText(/Your guitar was set up on/)).not.toBeInTheDocument()
  })
})

describe('guitar setup with an account', () => {
  const ACCOUNT_SETUP = { open: { 1: 1.7e-5, 2: 4.5e-5 }, misfit: { 1: 0.3, 2: 0.3 }, savedAt: '2026-10-28T10:00:00.000Z' }
  const noSetup = { 'GET /api/string-setup': () => [404, { detail: 'No guitar setup yet.' }] as [number, unknown] }

  it('before the first song: asks for the guitar setup (the server has none)', async () => {
    fakeServer({ ...signedInAs(USER), ...noSetup })
    renderApp('/songs/sample-first-frets/practice')
    expect(await screen.findByRole('heading', { name: 'Quick guitar setup' })).toBeInTheDocument()
    expect(screen.queryByTestId('expected-number')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: /Start setup/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Guitar setup' })).toBeInTheDocument()
  })

  it('with the setup on the account: practice straight away, string check on', async () => {
    fakeServer({ ...signedInAs(USER), 'GET /api/string-setup': () => [200, ACCOUNT_SETUP] })
    renderApp('/songs/sample-first-frets/practice')
    expect(await screen.findByTestId('same-pitch')).toHaveTextContent('The string check listens for the string')
    expect(localStorage.getItem(`guitar-practice:string-setup:${USER.id}`)).not.toBeNull() // a copy on this device
  })

  it('never blocked by the network: server unreachable, practice as before', async () => {
    fakeServer({ ...signedInAs(USER) }) // /api/string-setup fails like a network error
    renderApp('/songs/sample-first-frets/practice')
    expect(await screen.findByTestId('expected-number')).toHaveTextContent('10')
  })

  it('offline, the copy on this device is used', async () => {
    localStorage.setItem(`guitar-practice:string-setup:${USER.id}`, JSON.stringify(ACCOUNT_SETUP))
    fakeServer({ ...signedInAs(USER) })
    renderApp('/songs/sample-first-frets/practice')
    expect(await screen.findByTestId('same-pitch')).toHaveTextContent('The string check listens for the string')
  })

  it('a setup done on this phone without an account can be used for the account', async () => {
    saveSetup({ 1: 1.7e-5, 2: 4.5e-5 })
    const calls = fakeServer({ ...signedInAs(USER), ...noSetup, 'PUT /api/string-setup': (body) => [200, { ...(body as object), savedAt: '2026-10-29T08:00:00.000Z' }] })
    renderApp('/songs/sample-first-frets/practice')
    await userEvent.click(await screen.findByRole('button', { name: /Use this phone’s setup/ }))
    expect(await screen.findByTestId('same-pitch')).toHaveTextContent('The string check listens for the string')
    expect(calls.find((c) => c.key === 'PUT /api/string-setup')?.body).toEqual({ open: { 1: 1.7e-5, 2: 4.5e-5 }, misfit: {} })
  })

  /** Goes through the setup: strings 1 and 2 learned, the rest skipped. */
  async function doSetup() {
    await userEvent.click(await screen.findByRole('button', { name: /Start/ }))
    for (const b of [1.7e-5, 1.75e-5, 1.68e-5]) pluck(64, clean(b))
    for (const b of [4.5e-5, 4.4e-5, 4.6e-5]) pluck(59, clean(b))
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole('button', { name: 'Skip this string' }))
  }

  it('the first setup is saved with the account', async () => {
    const calls = fakeServer({ ...signedInAs(USER), ...noSetup, 'PUT /api/string-setup': (body) => [200, { ...(body as object), savedAt: '2026-10-29T08:00:00.000Z' }] })
    renderApp('/guitar-setup')
    await doSetup()
    expect(await screen.findByTestId('setup-result')).toHaveTextContent('Your guitar is set up!')
    expect(calls.find((c) => c.key === 'PUT /api/string-setup')?.body).toEqual({ open: { 1: 1.7e-5, 2: 4.5e-5 }, misfit: { 1: 0.3, 2: 0.3 } })
  })

  it('the student can delete the setup without doing a new one (asked first)', async () => {
    const calls = fakeServer({ ...signedInAs(USER), 'GET /api/string-setup': () => [200, ACCOUNT_SETUP], 'DELETE /api/string-setup': () => [204] })
    renderApp('/guitar-setup')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete my setup' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete your guitar setup? You will do a new one before your next song.')
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(calls.some((c) => c.key === 'DELETE /api/string-setup')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Delete my setup' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText(/Your guitar was set up on/)).not.toBeInTheDocument())
    expect(calls.filter((c) => c.key === 'DELETE /api/string-setup')).toHaveLength(1)
    expect(localStorage.getItem(`guitar-practice:string-setup:${USER.id}`)).toBeNull()
  })

  it('doing it again replaces the saved setup only when the student agrees', async () => {
    const calls = fakeServer({
      ...signedInAs(USER),
      'GET /api/string-setup': () => [200, ACCOUNT_SETUP],
      'PUT /api/string-setup': (body) => [200, { ...(body as object), savedAt: '2026-10-29T08:00:00.000Z' }],
    })
    renderApp('/guitar-setup')
    expect(await screen.findByText(/saved with your account/)).toBeInTheDocument()
    await doSetup()
    expect(await screen.findByRole('heading', { name: 'Use this new setup?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep my earlier setup' }))
    expect(screen.getByRole('heading', { name: 'Your earlier setup is kept' })).toBeInTheDocument()
    expect(calls.some((c) => c.key === 'PUT /api/string-setup')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Do it again' }))
    await doSetup()
    await userEvent.click(await screen.findByRole('button', { name: 'Save the new setup' }))
    expect(await screen.findByTestId('setup-result')).toHaveTextContent('Your guitar is set up!')
    expect(calls.filter((c) => c.key === 'PUT /api/string-setup')).toHaveLength(1)
  })
})
