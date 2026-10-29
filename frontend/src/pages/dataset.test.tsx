import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PracticeRecording } from '../audio/listeningSession'
import type { DetectedEvent } from '../audio/pitchTracker'
import type { ListeningState } from '../audio/useListening'
import { renderApp } from '../test/renderApp'
import { ADMIN, fakeServer, signedInAs, signedOut, USER } from '../test/fakeServer'

// A pretend microphone: the test "plucks" by sending the detector's events, and decides what the
// recording contains.
const mic = vi.hoisted(() => ({
  send: null as ((events: DetectedEvent[]) => void) | null,
  targets: [] as number[][],
  recordings: 0,
  deny: false,
}))
vi.mock('../audio/useListening', async () => {
  const { useState } = await import('react')
  const nothing = () => {}
  return {
    useListening: (onNoteEvents: (events: DetectedEvent[]) => void): ListeningState => {
      const [status, setStatus] = useState<ListeningState['status']>('idle')
      const [recording, setRecording] = useState(false)
      mic.send = onNoteEvents
      return {
        status,
        error: status === 'error' ? 'permission-denied' : null,
        autoStopped: false,
        reading: null,
        stats: null,
        start: () => setStatus(mic.deny ? 'error' : 'listening'),
        startFromFile: nothing,
        stop: () => setStatus('idle'),
        recording,
        startRecording: () => {
          mic.recordings++
          setRecording(true)
          return true
        },
        stopRecording: () => {
          setRecording(false)
          return take()
        },
        logEvent: nothing,
        resetNotes: nothing,
        setTargets: (midis) => mic.targets.push([...midis]),
        setChordTargets: nothing,
        setStiffnessProbe: nothing,
        playErrorSound: () => false,
        setSpeaking: nothing,
      }
    },
  }
})

/** One second of sound with one pluck at 0.7 s. */
function take(): PracticeRecording {
  const samples = new Float32Array(48000)
  samples[34000] = 0.6
  const frames = Array.from({ length: 40 }, (_, i) => ({ t: i * 25, hz: null, clarity: 0, rms: 0, midi: null, reliable: false, onset: i * 25 === 700, matchedTarget: false, target: null }))
  return { samples, sampleRate: 48000, log: { createdAt: '', userAgent: '', sampleRate: 48000, frameSize: 2048, intervalMs: 25, frames, events: [{ t: 700, kind: 'noteStart', noteId: 1, midi: 64 }] } }
}

const GUITAR = { id: 'g1', name: 'Yamaha black', guitarType: 'acoustic', stringMaterial: 'steel', woundStrings: [3, 4, 5, 6], samples: 0 }

function sample(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, guitarId: 'g1', guitarName: 'Yamaha black', guitarType: 'acoustic', stringMaterial: 'steel', stringNumber: 2, fret: 5, position: '25',
    expectedMidi: 64, expectedNote: 'E4', expectedHz: 329.63, stringConstruction: 'unwound', backgroundNoise: 'quiet', pluckMethod: 'finger',
    pluckStrength: 'medium', device: 'phone', notes: null, audioKey: `samples/${id}.wav`, audioFormat: 'wav-float32', sampleRate: 48000,
    bitDepth: 32, channels: 1, durationMs: 4000, audioBytes: 768044, peak: 0.6, pluckAtMs: 700, status: 'accepted', recordedAt: '2026-10-30T10:00:00Z', ...extra,
  }
}

const pluck = () => act(() => mic.send!([{ type: 'noteStart', noteId: 1, midi: 64, time: 0 }]))

beforeEach(() => {
  mic.recordings = 0
  mic.targets = []
  mic.deny = false
  URL.createObjectURL = vi.fn(() => 'blob:review')
  URL.revokeObjectURL = vi.fn()
})

async function recordOne() {
  await userEvent.click(await screen.findByRole('button', { name: /● Record/ }))
  expect(screen.getByTestId('dataset-cue')).toHaveTextContent(/Get ready|Pluck .* now/)
  pluck()
  expect(screen.getByTestId('dataset-cue')).toHaveTextContent('Got it… let it ring')
  await userEvent.click(screen.getByRole('button', { name: /Stop/ }))
}

describe('dataset collector: admin only', () => {
  it('other accounts and visitors see "Admins only", and nothing is asked from the server', async () => {
    const calls = fakeServer(signedInAs(USER))
    renderApp('/admin/dataset')
    expect(await screen.findByRole('heading', { name: 'Admins only' })).toBeInTheDocument()
    expect(calls.some((c) => c.key.includes('/api/dataset'))).toBe(false)
  })

  it('visitors too', async () => {
    fakeServer(signedOut)
    renderApp('/admin/dataset')
    expect(await screen.findByRole('heading', { name: 'Admins only' })).toBeInTheDocument()
  })

  it('the account menu links to it only for the admin', async () => {
    fakeServer({ ...signedInAs(ADMIN), 'GET /api/songs?scope=global': () => [200, { songs: [] }] })
    renderApp('/songs')
    await userEvent.click(await screen.findByRole('button', { name: /Account:/ }))
    expect(screen.getByRole('link', { name: /Dataset collector/ })).toHaveAttribute('href', '/admin/dataset')
  })

  it('a student has no such link', async () => {
    fakeServer({ ...signedInAs(USER), 'GET /api/songs?scope=global': () => [200, { songs: [] }] })
    renderApp('/songs')
    await userEvent.click(await screen.findByRole('button', { name: /Account:/ }))
    expect(screen.queryByRole('link', { name: /Dataset collector/ })).toBeNull()
  })
})

describe('dataset collector: recording', () => {
  it('first guitar, then record, listen and save with every label', async () => {
    let guitars: object[] = []
    let uploaded: FormData | null = null
    const calls = fakeServer({
      ...signedInAs(ADMIN),
      'GET /api/dataset/guitars': () => [200, guitars],
      'POST /api/dataset/guitars': (body) => {
        guitars = [{ ...GUITAR, ...(body as object) }]
        return [201, guitars[0]]
      },
      'GET /api/dataset/guitars/g1/progress': () => [200, []],
      'POST /api/dataset/samples': (body) => {
        uploaded = body as FormData
        return [201, { sample: sample('s1'), countAtPosition: 1 }]
      },
    })
    renderApp('/admin/dataset')
    // No guitar yet: add one (acoustic: steel, strings 3-6 wound).
    await userEvent.type(await screen.findByLabelText('Guitar name'), 'Yamaha black')
    await userEvent.click(screen.getByRole('button', { name: 'Add guitar' }))
    expect(calls.find((c) => c.key === 'POST /api/dataset/guitars')!.body).toEqual({ name: 'Yamaha black', guitarType: 'acoustic', stringMaterial: 'steel', woundStrings: [3, 4, 5, 6] })
    await userEvent.click(screen.getByRole('radio', { name: 'Pick' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByLabelText('Guitar and conditions')).toHaveTextContent('Yamaha black')
    expect(screen.getByLabelText('Guitar and conditions')).toHaveTextContent('quiet · pick · medium · phone · 5 per position')

    // Position 25 from the grid.
    await userEvent.click(screen.getByRole('button', { name: /^25: string 2, fret 5/ }))
    expect(screen.getByTestId('dataset-position')).toHaveTextContent('25')
    expect(screen.getByLabelText('Position')).toHaveTextContent('E4 · 329.63 Hz · plain')
    expect(mic.targets.at(-1)).toEqual([64])

    await userEvent.click(screen.getByRole('button', { name: /Turn on the microphone/ }))
    await recordOne()
    // Review: play it back as often as wanted; nothing is saved yet.
    expect(screen.getByTestId('dataset-review-audio')).toHaveAttribute('src', 'blob:review')
    expect(screen.getByText('✓ One clear pluck')).toBeInTheDocument()
    expect(calls.some((c) => c.key === 'POST /api/dataset/samples')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: /Save/ }))
    expect(await screen.findByTestId('dataset-saved')).toHaveTextContent('Saved ✓ 1 of 5 at 25.')
    const meta = JSON.parse(uploaded!.get('meta') as string)
    expect(meta).toEqual({
      guitarId: 'g1', stringNumber: 2, fret: 5, backgroundNoise: 'quiet', pluckMethod: 'pick', pluckStrength: 'medium', device: 'phone', notes: null,
      pluckAtMs: 700, capture: { sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    const audio = uploaded!.get('audio') as File
    expect(audio.type).toBe('audio/wav')
    expect(new TextDecoder().decode((await audio.arrayBuffer()).slice(0, 4))).toBe('RIFF')
    // The same position and settings stay for the next pluck.
    expect(screen.getByTestId('dataset-position')).toHaveTextContent('25')
    expect(screen.getByRole('button', { name: /^25: string 2, fret 5, 1 of 5 saved/ })).toBeInTheDocument()
  })

  it('retake and discard: nothing is saved', async () => {
    localStorage.setItem('guitar-practice:dataset-session', JSON.stringify({ guitarId: 'g1' }))
    const calls = fakeServer({ ...signedInAs(ADMIN), 'GET /api/dataset/guitars': () => [200, [GUITAR]], 'GET /api/dataset/guitars/g1/progress': () => [200, []] })
    renderApp('/admin/dataset')
    await userEvent.click(await screen.findByRole('button', { name: /Turn on the microphone/ }))
    await recordOne()
    await userEvent.click(screen.getByRole('button', { name: /Retake/ }))
    await waitFor(() => expect(mic.recordings).toBe(2))
    expect(screen.getByTestId('dataset-cue')).toBeInTheDocument()
    pluck()
    await userEvent.click(screen.getByRole('button', { name: /Stop/ }))
    await userEvent.click(screen.getByRole('button', { name: /Discard/ }))
    expect(screen.getByRole('button', { name: /Record 10/ })).toBeInTheDocument()
    expect(calls.some((c) => c.key === 'POST /api/dataset/samples')).toBe(false)
  })

  it('a failed save keeps the take, to try again', async () => {
    localStorage.setItem('guitar-practice:dataset-session', JSON.stringify({ guitarId: 'g1' }))
    fakeServer({
      ...signedInAs(ADMIN),
      'GET /api/dataset/guitars': () => [200, [GUITAR]],
      'GET /api/dataset/guitars/g1/progress': () => [200, []],
      'POST /api/dataset/samples': () => [502, { detail: 'The audio could not be stored, so nothing was saved. Please try again.' }],
    })
    renderApp('/admin/dataset')
    await userEvent.click(await screen.findByRole('button', { name: /Turn on the microphone/ }))
    await recordOne()
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('nothing was saved')
    expect(screen.getByRole('button', { name: /Save/ })).toBeEnabled()
    expect(screen.getByTestId('dataset-review-audio')).toBeInTheDocument()
  })

  it('when a position has enough plucks, the next unfinished one is chosen', async () => {
    localStorage.setItem('guitar-practice:dataset-session', JSON.stringify({ guitarId: 'g1', target: 3 }))
    fakeServer({
      ...signedInAs(ADMIN),
      'GET /api/dataset/guitars': () => [200, [GUITAR]],
      'GET /api/dataset/guitars/g1/progress': () => [200, [{ stringNumber: 1, fret: 0, count: 2 }, { stringNumber: 1, fret: 1, count: 3 }]],
      'POST /api/dataset/samples': () => [201, { sample: sample('s1', { stringNumber: 1, fret: 0, position: '10' }), countAtPosition: 3 }],
    })
    renderApp('/admin/dataset')
    expect(await screen.findByRole('button', { name: /^11: string 1, fret 1, 3 of 3 saved/ })).toHaveTextContent('✓')
    await userEvent.click(screen.getByRole('button', { name: /Turn on the microphone/ }))
    await recordOne()
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))
    expect(await screen.findByTestId('dataset-saved')).toHaveTextContent('Saved ✓ 3 of 3 at 10. 10 is done. Next: 12.')
    expect(screen.getByTestId('dataset-position')).toHaveTextContent('12')
  })

  it('microphone refused: says so', async () => {
    mic.deny = true
    localStorage.setItem('guitar-practice:dataset-session', JSON.stringify({ guitarId: 'g1' }))
    fakeServer({ ...signedInAs(ADMIN), 'GET /api/dataset/guitars': () => [200, [GUITAR]], 'GET /api/dataset/guitars/g1/progress': () => [200, []] })
    renderApp('/admin/dataset')
    await userEvent.click(await screen.findByRole('button', { name: /Turn on the microphone/ }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /● Record/ })).toBeNull()
  })
})

describe('dataset collector: samples', () => {
  it('list, filter, play, mark, delete and export', async () => {
    const open3 = sample('s2', { position: '30', stringNumber: 3, fret: 0 })
    let items = [sample('s1'), open3]
    const calls = fakeServer({
      ...signedInAs(ADMIN),
      'GET /api/dataset/guitars': () => [200, [GUITAR]],
      'GET /api/dataset/samples?page=1&pageSize=20': () => [200, { items, total: items.length, page: 1, pageSize: 20 }],
      'GET /api/dataset/samples?stringNumber=3&page=1&pageSize=20': () => [200, { items: [open3], total: 1, page: 1, pageSize: 20 }],
      'GET /api/dataset/samples/s1/audio-url': () => [200, { url: 'https://storage.example/s1?signed' }],
      'PATCH /api/dataset/samples/s1': (body) => [200, { ...items[0], ...(body as object) }],
      'DELETE /api/dataset/samples/s1': () => {
        items = items.slice(1)
        return [204]
      },
      'GET /api/dataset/export?stringNumber=3&format=csv': () => [200, 'csv'],
    })
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderApp('/admin/dataset')
    await userEvent.click(await screen.findByRole('button', { name: /Samples/ }))
    expect(await screen.findByTestId('dataset-total')).toHaveTextContent('2 samples')
    const [first] = screen.getAllByTestId('dataset-sample')

    await userEvent.click(within(first).getByRole('button', { name: /Play/ }))
    await waitFor(() => expect(first.querySelector('audio')).toHaveAttribute('src', 'https://storage.example/s1?signed'))

    await userEvent.selectOptions(within(first).getByLabelText('Status of 25'), 'rejected')
    expect(calls.find((c) => c.key === 'PATCH /api/dataset/samples/s1')!.body).toEqual({ status: 'rejected' })
    await waitFor(() => expect(within(first).getByLabelText('Status of 25')).toHaveValue('rejected'))

    await userEvent.click(within(first).getByRole('button', { name: /Delete/ }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByTestId('dataset-total')).toHaveTextContent('1 sample'))

    await userEvent.selectOptions(screen.getByLabelText('String'), '3')
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /api/dataset/samples?stringNumber=3&page=1&pageSize=20')).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: /CSV/ }))
    await waitFor(() => expect(clicked).toHaveBeenCalled())
    expect(calls.some((c) => c.key === 'GET /api/dataset/export?stringNumber=3&format=csv')).toBe(true)
  })
})
