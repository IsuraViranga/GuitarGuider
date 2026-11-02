import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DetectedEvent } from '../audio/pitchTracker'
import type { Stiffness } from '../audio/stringCheck'
import type { ListeningState } from '../audio/useListening'
import { fingerprint } from '../dataset/soundMatch'
import { renderApp } from '../test/renderApp'
import { fakeServer, signedInAs, signedOut, USER } from '../test/fakeServer'

// A pretend microphone (practice), and pretend measurements of recordings (older recordings).
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

/** A measured pluck: its second overtone `second` dB (the colour that differs), stiffness `b`. */
const sounding = (second: number, b: number): Stiffness => ({ b, overtones: 24, misfit: 0.4, harmonics: [0, second, ...Array.from({ length: 14 }, () => -20)] })
/**
 * The recorded guitar: each open string 3 times, and 25 (same note as 10) 3 times. Strings 1 and 2
 * are almost as stiff at 10 and 25 (×1.2), so the setup alone cannot check 10; their colour differs.
 */
const OPEN_B: Record<number, number> = { 1: 3e-5, 2: 2e-5, 3: 4e-5, 4: 6e-5, 5: 9e-5, 6: 1.4e-4 }
const ROWS = [
  ...[1, 2, 3, 4, 5, 6].flatMap((s) => (s === 1 ? [-12, -11.5, -12.5] : [-8, -8.5, -7.5]).map((second) => ({ stringNumber: s, fret: 0, v: fingerprint(sounding(second, OPEN_B[s]))! }))),
  ...[-2, -2.5, -1.5].map((second) => ({ stringNumber: 2, fret: 5, v: fingerprint(sounding(second, OPEN_B[2] * 2 ** (5 / 6)))! })),
].map((r, i) => ({ sampleId: `s${i}`, ...r }))
const NO_NAME = { id: 'g1', name: 'No name', guitarType: 'electric', stringMaterial: 'steel', woundStrings: [4, 5, 6], samples: 21, fingerprints: 21, missingFingerprints: 0, ownerName: 'Melantha', mine: false, isDefault: true }
const setupOf = (open: Record<number, number>) => ({ open, savedAt: '2026-11-02T10:00:00.000Z' })

describe('older recordings get their fingerprints (record my guitar)', () => {
  it('reads only the recordings without one, and saves each fingerprint as soon as it is made', async () => {
    const mine = { ...NO_NAME, name: 'My Yamaha', mine: true, isDefault: false, fingerprints: 0, missingFingerprints: 6, samples: 6 }
    const sample = (i: number) => ({ id: `s${i}`, guitarId: 'g1', guitarName: 'My Yamaha', stringNumber: 1, fret: 0, position: '10', expectedMidi: 64, expectedNote: 'E4',
      expectedHz: 329.63, stringConstruction: 'unwound', backgroundNoise: 'quiet', pluckMethod: 'finger', pluckStrength: 'medium', device: 'phone', notes: null,
      durationMs: 4000, sampleRate: 48000, peak: 0.5, hasFingerprint: false, status: 'accepted', recordedAt: '2026-11-01T10:00:00Z' })
    const page = { items: [0, 1, 2, 3, 4, 5].map(sample), total: 6, page: 1, pageSize: 20 }
    const routes = Object.fromEntries([0, 1, 2, 3, 4, 5].flatMap((i) => [
      [`GET /api/dataset/samples/s${i}/audio`, () => [200, {}] as [number, unknown]],
      [`PUT /api/dataset/samples/s${i}/fingerprint`, () => [200, { ...sample(i), hasFingerprint: true }] as [number, unknown]],
    ]))
    const calls = fakeServer({
      ...signedInAs(USER),
      'GET /api/dataset/guitars': () => [200, [mine]],
      'GET /api/dataset/samples?page=1&pageSize=20': () => [200, page],
      'GET /api/dataset/samples?guitarId=g1&page=1&pageSize=20': () => [200, page],
      'GET /api/dataset/samples?guitarId=g1&page=1&pageSize=100': () => [200, { ...page, pageSize: 100 }],
      ...routes,
    })
    mic.measured = [0, 1, 2, 3, 4, 5].map(() => sounding(-10, 3e-5))
    renderApp('/record-guitar')
    await userEvent.click(await screen.findByRole('button', { name: /My recordings/ }))
    await userEvent.selectOptions(within(screen.getByLabelText('Filters')).getByLabelText('Guitar'), 'g1')
    const card = await screen.findByLabelText('Sound match')
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument() // the default guitar: admin only
    await userEvent.click(within(card).getByRole('button', { name: 'Update 6 older recordings' }))
    expect(await screen.findByTestId('sound-match-ready')).toHaveTextContent('Updated 6 recordings.')
    expect(calls.filter((c) => c.key.endsWith('/fingerprint'))).toHaveLength(6)
    expect(calls.find((c) => c.key === 'PUT /api/dataset/samples/s0/fingerprint')!.body).toEqual({ v: fingerprint(sounding(-10, 3e-5)) })
    expect(within(card).queryByRole('button', { name: /older recordings/ })).not.toBeInTheDocument()
  })
})

describe('guitar for the string check, in practice (signed-in players)', () => {
  const server = (user: object, open: Record<number, number>, guitars = [NO_NAME]) =>
    fakeServer({
      ...signedInAs(user),
      'GET /api/string-setup': () => [200, setupOf(open)],
      'GET /api/dataset/guitars': () => [200, guitars],
      'GET /api/dataset/guitars/g1/fingerprints': () => [200, { fingerprints: ROWS }],
    })
  const play = (noteId: number, stiffness: Stiffness) =>
    act(() =>
      mic.send!([
        { type: 'noteStart', noteId, midi: 64, time: 0, stiffness },
        { type: 'noteConfirmed', noteId, midi: 64, time: 0, stiffness },
      ]),
    )

  it('the default guitar matches this guitar: 25 played for 10 is caught', async () => {
    server(USER, OPEN_B)
    renderApp('/songs/sample-first-frets/practice') // 10 11 13 ...
    await vi.waitFor(() => expect(screen.getByTestId('guitar-choice-status')).toHaveTextContent(/Using No name: same-sounding places/))
    await vi.waitFor(() => expect(mic.probes.at(-1)).toBe(64)) // 10 = E4 is measured
    expect(screen.getByTestId('same-pitch')).toHaveTextContent('The string check listens for the string')
    play(900, sounding(-2, 3.5e-5))
    expect(screen.getByTestId('feedback')).toHaveTextContent('Right note, wrong string. That sounded like 25 (string 2, fret 5).')
    expect(screen.getByTestId('expected-number')).toHaveTextContent('10')
    play(901, sounding(-12, 3e-5))
    expect(screen.getByTestId('feedback')).toHaveTextContent('Correct note!')
    expect(screen.getByTestId('expected-number')).toHaveTextContent('11')
  })

  it('another guitar (its strings sound different): the normal check, quietly, and nothing is called wrong', async () => {
    server(USER, Object.fromEntries(Object.entries(OPEN_B).map(([s, b]) => [s, b * 2])))
    renderApp('/songs/sample-first-frets/practice')
    await vi.waitFor(() => expect(screen.getByTestId('guitar-choice-status')).toHaveTextContent('The string check uses your guitar setup.'))
    expect(screen.getByTestId('guitar-choice-status')).not.toHaveTextContent(/match/)
    expect(mic.probes.at(-1)).toBeNull()
    play(900, sounding(-2, 7e-5))
    expect(screen.getByTestId('feedback')).toHaveTextContent('Correct note!')
    expect(screen.getByRole('link', { name: /Record my guitar/ })).toHaveAttribute('href', '/record-guitar')
  })

  it('a chosen guitar that does not fit this guitar: the default guitar is used instead', async () => {
    const other = { ...NO_NAME, id: 'g2', name: 'Sqoe', isDefault: false }
    const sqoeRows = ROWS.map((r) => ({ ...r, v: fingerprint(sounding(-8, 2.5e-4))! }))
    fakeServer({
      ...signedInAs(USER),
      'GET /api/string-setup': () => [200, setupOf(OPEN_B)],
      'GET /api/dataset/guitars': () => [200, [NO_NAME, other]],
      'GET /api/dataset/guitars/g1/fingerprints': () => [200, { fingerprints: ROWS }],
      'GET /api/dataset/guitars/g2/fingerprints': () => [200, { fingerprints: sqoeRows }],
    })
    localStorage.setItem(`guitar-practice:sound-match-guitar:${USER.id}`, 'g2')
    renderApp('/songs/sample-first-frets/practice')
    await vi.waitFor(() => expect(screen.getByTestId('guitar-choice-status')).toHaveTextContent(/Using No name/))
    expect(screen.getByRole('combobox', { name: /Guitar for the string check/ })).toHaveValue('g2') // the choice is kept
    await vi.waitFor(() => expect(mic.probes.at(-1)).toBe(64))
    play(900, sounding(-2, 3.5e-5))
    expect(screen.getByTestId('feedback')).toHaveTextContent('That sounded like 25 (string 2, fret 5).')
  })

  it('off, remembered for this player on this device', async () => {
    const calls = server(USER, OPEN_B)
    renderApp('/songs/sample-first-frets/practice')
    await vi.waitFor(() => expect(screen.getByTestId('guitar-choice-status')).toHaveTextContent(/Using No name/))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Guitar for the string check/ }), 'off')
    expect(screen.getByTestId('guitar-choice-status')).toHaveTextContent('Off: the string check uses your guitar setup only.')
    expect(localStorage.getItem(`guitar-practice:sound-match-guitar:${USER.id}`)).toBe('off')
    play(900, sounding(-2, 3.5e-5))
    expect(screen.getByTestId('feedback')).toHaveTextContent('Correct note!')
    expect(calls.filter((c) => c.key.endsWith('/fingerprints'))).toHaveLength(1) // loaded once for the default, before Off
  })

  it('lists every recorded guitar: the default, theirs, other players', async () => {
    const mine = { ...NO_NAME, id: 'g2', name: 'My Yamaha', mine: true, isDefault: false, ownerName: 'Isura Perera' }
    server(USER, OPEN_B, [NO_NAME, mine])
    renderApp('/songs/sample-first-frets/practice')
    const choice = await screen.findByRole('combobox', { name: /Guitar for the string check/ })
    await vi.waitFor(() =>
      expect(within(choice).getAllByRole('option').map((o) => o.textContent)).toEqual(['Default (No name)', 'No name · by Melantha', 'My Yamaha · yours', 'Off']),
    )
    expect(screen.getByRole('link', { name: /Record another guitar/ })).toBeInTheDocument()
  })

  it('visitors: no choice, and nothing is asked about recorded guitars', async () => {
    localStorage.setItem('guitar-practice:string-setup', JSON.stringify(setupOf(OPEN_B)))
    const calls = fakeServer(signedOut)
    renderApp('/songs/sample-first-frets/practice')
    await screen.findByTestId('expected-number')
    expect(screen.queryByRole('combobox', { name: /Guitar for the string check/ })).not.toBeInTheDocument()
    expect(calls.some((c) => c.key.includes('/api/dataset'))).toBe(false)
  })
})

describe('test my guitar (record my guitar page)', () => {
  const MINE = { ...NO_NAME, name: 'My Yamaha', mine: true, isDefault: false }
  const server = (guitar: object) =>
    fakeServer({
      ...signedInAs(USER),
      'GET /api/dataset/guitars': () => [200, [guitar]],
      'GET /api/dataset/guitars/g1/fingerprints': () => [200, { fingerprints: ROWS }],
      'GET /api/dataset/guitars/g1/progress': () => [200, []],
      'GET /api/dataset/samples?guitarId=g1&stringNumber=1&fret=0&page=1&pageSize=20': () => [200, { items: [], total: 0, page: 1, pageSize: 20 }],
    })
  const pluck = (noteId: number, stiffness: Stiffness | undefined, midi = 64) => act(() => mic.send!([{ type: 'noteStart', noteId, midi, time: 0, stiffness }]))
  const openTest = async () => {
    renderApp('/record-guitar')
    await userEvent.click(await screen.findByRole('button', { name: /Test/ }))
    await userEvent.click(await screen.findByRole('button', { name: /^E4/ }))
    expect(await screen.findByTestId('test-pairs')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Start listening/ }))
  }

  it('names the place played, and keeps a score', async () => {
    server(MINE)
    await openTest()
    expect(mic.probes.at(-1)).toBe(64)
    pluck(900, sounding(-2, 3.5e-5))
    expect(screen.getByTestId('test-result')).toHaveTextContent('Heard at25string 2, fret 5')
    await userEvent.click(screen.getByRole('button', { name: '✓ Yes' }))
    expect(screen.getByTestId('test-score')).toHaveTextContent('✓ Right 1')
    pluck(901, sounding(-12, 3e-5))
    expect(screen.getByTestId('test-result')).toHaveTextContent('Heard at10string 1, open')
    pluck(902, undefined, 65)
    expect(screen.getByTestId('test-result')).toHaveTextContent('That was F4. Play E4.')
  })

  it('not heard right on their own guitar: say where, then add a recording of that place', async () => {
    server(MINE)
    await openTest()
    pluck(900, sounding(-2, 3.5e-5))
    await userEvent.click(screen.getByRole('button', { name: '✗ No' }))
    expect(screen.getByTestId('test-score')).toHaveTextContent('✗ Wrong 1')
    await userEvent.click(within(screen.getByTestId('test-fix')).getByRole('button', { name: '10' }))
    await userEvent.click(screen.getByRole('button', { name: /Add a recording of 10/ }))
    expect(await screen.findByRole('button', { name: /^10: string 1, fret 0/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('…or check the recordings of that place', async () => {
    server(MINE)
    await openTest()
    pluck(900, sounding(-2, 3.5e-5))
    await userEvent.click(screen.getByRole('button', { name: '✗ No' }))
    await userEvent.click(within(screen.getByTestId('test-fix')).getByRole('button', { name: '10' }))
    await userEvent.click(screen.getByRole('button', { name: /Check its recordings/ }))
    const filters = await screen.findByLabelText('Filters')
    expect(within(filters).getByLabelText('Guitar')).toHaveValue('g1')
    expect(within(filters).getByLabelText('String')).toHaveValue('1')
    expect(within(filters).getByLabelText('Fret')).toHaveValue('0')
  })

  it('every note up to fret 7 can be tested, also one with a single place (E2: string 6, open)', async () => {
    server(MINE)
    renderApp('/record-guitar')
    await userEvent.click(await screen.findByRole('button', { name: /Test/ }))
    const notes = within(await screen.findByRole('group', { name: 'Note to play' })).getAllByRole('button')
    expect(notes).toHaveLength(32) // E2 (string 6, open) to B4 (string 1, fret 7): all 48 places
    expect(notes[0]).toHaveTextContent('E260')
    expect(notes.at(-1)).toHaveTextContent('B417')
    await userEvent.click(notes[0])
    expect(await screen.findByTestId('test-pairs')).toBeInTheDocument()
    expect(screen.getByText(/^Play/)).toHaveTextContent('Play E2 at 60')
    await userEvent.click(screen.getByRole('button', { name: /Start listening/ }))
    expect(mic.probes.at(-1)).toBe(40)
    pluck(900, sounding(-8, OPEN_B[6]), 40)
    expect(screen.getByTestId('test-result')).toHaveTextContent('Heard at60string 6, open')
    await userEvent.click(screen.getByRole('button', { name: '✗ No' }))
    await userEvent.click(within(screen.getByTestId('test-fix')).getByRole('button', { name: '60' }))
    expect(screen.getByRole('button', { name: /Add a recording of 60/ })).toBeInTheDocument()
  })

  it("another player's guitar: tested, but only its owner can change its recordings", async () => {
    server(NO_NAME)
    await openTest()
    pluck(900, sounding(-2, 3.5e-5))
    await userEvent.click(screen.getByRole('button', { name: '✗ No' }))
    await userEvent.click(within(screen.getByTestId('test-fix')).getByRole('button', { name: '10' }))
    expect(screen.getByTestId('test-fix')).toHaveTextContent('Only the owner of No name can change its recordings.')
    expect(screen.queryByRole('button', { name: /Add a recording/ })).not.toBeInTheDocument()
  })
})
