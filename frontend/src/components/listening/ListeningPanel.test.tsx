import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyMicrophoneError, MUSIC_AUDIO_CONSTRAINTS } from '../../audio/microphone'
import { useListening } from '../../audio/useListening'
import { ListeningPanel } from './ListeningPanel'

function Panel() {
  const listening = useListening(() => {})
  return <ListeningPanel listening={listening} errorSound onErrorSoundChange={() => {}} boost={false} onBoostChange={() => {}} />
}

class FakeAudioContext {
  sampleRate = 48000
  currentTime = 0
  resume = vi.fn(async () => {})
  close = vi.fn(async () => {})
}

function mockBrowser({ secure = true, getUserMedia }: { secure?: boolean; getUserMedia?: () => Promise<MediaStream> }) {
  vi.stubGlobal('AudioContext', FakeAudioContext)
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: secure })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: getUserMedia ? { getUserMedia: vi.fn(getUserMedia) } : undefined,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ListeningPanel', () => {
  it('explains what the microphone is for before asking', () => {
    mockBrowser({ getUserMedia: () => new Promise(() => {}) })
    render(<Panel />)
    expect(screen.getByText(/Nothing is recorded or uploaded/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start listening/ })).toBeInTheDocument()
  })

  it('asks for the microphone with phone call processing switched off', async () => {
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}))
    mockBrowser({ getUserMedia })
    render(<Panel />)
    await userEvent.click(screen.getByRole('button', { name: /Start listening/ }))
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: MUSIC_AUDIO_CONSTRAINTS, video: false })
    expect(screen.getByText('Waiting for microphone permission…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pause listening/ })).toBeInTheDocument()
  })

  it('handles a denied permission with clear instructions and a retry button', async () => {
    mockBrowser({ getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) })
    render(<Panel />)
    await userEvent.click(screen.getByRole('button', { name: /Start listening/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission is blocked.*Allow/)
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })

  it('explains that phones need https', async () => {
    mockBrowser({ secure: false })
    render(<Panel />)
    await userEvent.click(screen.getByRole('button', { name: /Start listening/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/secure address \(starting with https:\/\/\)/)
  })

  it('maps browser errors to understandable categories', () => {
    expect(classifyMicrophoneError(new DOMException('', 'NotFoundError'))).toBe('no-device')
    expect(classifyMicrophoneError(new DOMException('', 'NotReadableError'))).toBe('in-use')
    expect(classifyMicrophoneError(new Error('?'))).toBe('unknown')
  })
})
