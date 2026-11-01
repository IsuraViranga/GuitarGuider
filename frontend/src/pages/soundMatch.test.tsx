import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DetectedEvent } from '../audio/pitchTracker'
import type { Stiffness } from '../audio/stringCheck'
import type { ListeningState } from '../audio/useListening'
import { fingerprint } from '../dataset/soundMatch'
import { renderApp } from '../test/renderApp'
import { ADMIN, fakeServer, signedInAs, USER } from '../test/fakeServer'

// A pretend microphone (practice), and pretend measurements of recordings (preparing a guitar).
const mic = vi.hoisted(() => ({
  send: null as ((events: DetectedEvent[]) => void) | null,
  probes: [] as (number | null)[],
  measured: [] as Stiffness[],
}))
vi.mock('../audio/useListening', async () => {
  const { useState } = await import('react')
  const nothing = () => {}
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
        setStiffnessProbe: (midi: number | null) => mic.probes.push(midi),
        playErrorSound: () => false,
        setSpeaking: nothing,
      }
    },
  }
})
vi.mock('../audio/wav', async (original) => ({ ...(await original<typeof import('../audio/wav')>()), decodeWav: () => ({ samples: new Float32Array(16), sampleRate: 48000 }) }))
vi.mock('../dataset/soundMatch', async (original) => ({
  ...(await original<typeof import('../dataset/soundMatch')>()),
  measureRecording: () => mic.measured.shift() ?? null,
}))

/** A measured pluck whose second overtone is `second` dB: about -12 on string 1 open (10), -2 on 25. */
const sounding = (second: number): Stiffness => ({ b: 2e-5, overtones: 24, misfit: 0.4, harmonics: [0, second, ...Array.from({ length: 14 }, () => -20)] })
const PLACES = [
  ...[-12, -11.5, -12.5].map((second, i) => ({ id: `s${i + 1}`, stringNumber: 1, fret: 0, second })),
  ...[-2, -2.5, -1.5].map((second, i) => ({ id: `s${i + 4}`, stringNumber: 2, fret: 5, second })),
]
const GUITAR = { id: 'g1', name: 'No name', guitarType: 'electric', stringMaterial: 'steel', woundStrings: [4, 5, 6], samples: 6, fingerprints: 0 }
const ROWS = PLACES.map((p) => ({ sampleId: p.id, stringNumber: p.stringNumber, fret: p.fret, v: fingerprint(sounding(p.second))! }))

describe('sound match: preparing a recorded guitar (dataset collector)', () => {
  it('measures every recording of the guitar in the browser and keeps the fingerprints', async () => {
    const sample = (p: (typeof PLACES)[number]) => ({ id: p.id, guitarId: 'g1', guitarName: 'No name', stringNumber: p.stringNumber, fret: p.fret, position: `${p.stringNumber}${p.fret}`,
      expectedMidi: 64, expectedNote: 'E4', expectedHz: 329.63, stringConstruction: 'unwound', backgroundNoise: 'quiet', pluckMethod: 'finger', pluckStrength: 'medium',
      device: 'phone', notes: null, durationMs: 4000, sampleRate: 48000, peak: 0.5, status: 'accepted', recordedAt: '2026-11-01T10:00:00Z' })
    const page = { items: PLACES.map(sample), total: 6, page: 1, pageSize: 20 }
    const audio = Object.fromEntries(PLACES.map((p) => [`GET /api/dataset/samples/${p.id}/audio`, () => [200, {}] as [number, unknown]]))
    const calls = fakeServer({
      ...signedInAs(ADMIN),
      'GET /api/dataset/guitars': () => [200, [GUITAR]],
      'GET /api/dataset/samples?page=1&pageSize=20': () => [200, page],
      'GET /api/dataset/samples?guitarId=g1&page=1&pageSize=20': () => [200, page],
      'GET /api/dataset/samples?guitarId=g1&page=1&pageSize=100': () => [200, { ...page, pageSize: 100 }],
      ...audio,
      'PUT /api/dataset/guitars/g1/fingerprints': () => [200, { ...GUITAR, fingerprints: 6 }],
    })
    mic.measured = PLACES.map((p) => sounding(p.second))
    renderApp('/admin/dataset')
    await userEvent.click(await screen.findByRole('button', { name: /Samples/ }))
    await userEvent.selectOptions(within(screen.getByLabelText('Filters')).getByLabelText('Guitar'), 'g1')
    const card = await screen.findByLabelText('Sound match')
    await userEvent.click(within(card).getByRole('button', { name: 'Prepare sound match from these recordings' }))
    expect(await screen.findByTestId('sound-match-ready')).toHaveTextContent('Ready: 6 plucks. 1 of 16 same-note pairs can be told apart on this guitar.')
    expect(calls.find((c) => c.key === 'PUT /api/dataset/guitars/g1/fingerprints')!.body).toEqual({ fingerprints: ROWS })
    expect(within(card).getByRole('button', { name: 'Prepare again' })).toBeInTheDocument()
  })
})

describe('sound match in practice (admin test)', () => {
  // String 2 not in the setup: the string check has no plan for 10, so only the sound match can tell.
  const SETUP = { open: { 1: 1.7e-5 }, misfit: { 1: 0.3 }, savedAt: '2026-10-28T10:00:00.000Z' }
  const server = (user: object) =>
    fakeServer({
      ...signedInAs(user),
      'GET /api/string-setup': () => [200, SETUP],
      'GET /api/dataset/guitars': () => [200, [{ ...GUITAR, fingerprints: 6 }]],
      'GET /api/dataset/guitars/g1/fingerprints': () => [200, { fingerprints: ROWS, madeAt: '2026-11-01T10:00:00Z' }],
    })

  it('compared with a recorded guitar: 25 played for 10 is caught', async () => {
    server(ADMIN)
    renderApp('/songs/sample-first-frets/practice') // 10 11 13 ...
    await screen.findByTestId('expected-number')
    expect(mic.probes.at(-1)).toBeNull() // the string check alone cannot check 10 with this setup
    await userEvent.selectOptions(await screen.findByLabelText(/Compare with recorded guitar/), 'g1')
    await vi.waitFor(() => expect(mic.probes.at(-1)).toBe(64)) // now 10 = E4 is measured
    act(() =>
      mic.send!([
        { type: 'noteStart', noteId: 900, midi: 64, time: 0, stiffness: sounding(-2) },
        { type: 'noteConfirmed', noteId: 900, midi: 64, time: 0, stiffness: sounding(-2) },
      ]),
    )
    expect(screen.getByTestId('feedback')).toHaveTextContent('Right note, wrong string. That sounded like 25 (string 2, fret 5).')
    expect(screen.getByTestId('expected-number')).toHaveTextContent('10')
    // Played on string 1: correct, on to 11.
    act(() => mic.send!([{ type: 'noteStart', noteId: 901, midi: 64, time: 0, stiffness: sounding(-12) }]))
    expect(screen.getByTestId('feedback')).toHaveTextContent('Correct note!')
    expect(screen.getByTestId('expected-number')).toHaveTextContent('11')
    expect(localStorage.getItem('guitar-practice:sound-match-guitar')).toBe('g1')
  })

  it('anyone but the admin: no choice, and nothing is asked about recorded guitars', async () => {
    const calls = server(USER)
    renderApp('/songs/sample-first-frets/practice')
    await screen.findByTestId('expected-number')
    expect(screen.queryByLabelText(/Compare with recorded guitar/)).not.toBeInTheDocument()
    expect(calls.some((c) => c.key.includes('/api/dataset'))).toBe(false)
  })
})
