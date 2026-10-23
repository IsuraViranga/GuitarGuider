// Microphone access. Audio is analysed on the device; it is never recorded or uploaded.

export type MicrophoneErrorKind =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-device'
  | 'in-use'
  | 'device-lost'
  | 'unreadable-file'
  | 'unknown'

export class MicrophoneError extends Error {
  readonly kind: MicrophoneErrorKind

  constructor(kind: MicrophoneErrorKind, cause?: unknown) {
    super(MICROPHONE_ERROR_MESSAGES[kind], { cause })
    this.kind = kind
  }
}

export const MICROPHONE_ERROR_MESSAGES: Record<MicrophoneErrorKind, string> = {
  'insecure-context':
    'The microphone only works on a secure address (starting with https://). On a phone, open the https address shown by "npm run dev:phone".',
  unsupported: 'This browser cannot use the microphone. Please use an up-to-date Chrome.',
  'permission-denied':
    'Microphone permission is blocked. In Chrome, tap the icon to the left of the address, choose Permissions → Microphone → Allow, then try again.',
  'no-device': 'No microphone was found on this device.',
  'in-use': 'The microphone is being used by another app (for example a call or a recorder). Close it and try again.',
  'device-lost': 'The microphone stopped working. Tap "Start listening" to try again.',
  'unreadable-file': 'That audio file could not be played. Try an MP3, M4A or WAV file.',
  unknown: 'The microphone could not be started. Please try again.',
}

/**
 * Phone browsers process the microphone for phone calls by default (echo cancellation,
 * noise suppression, automatic volume). That distorts musical notes, so it is switched off.
 */
export const MUSIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
}

export function classifyMicrophoneError(error: unknown): MicrophoneErrorKind {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission-denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-device'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use'
    default:
      return 'unknown'
  }
}

/** Checks that need no permission prompt, so problems can be explained before asking. */
export function microphoneAvailability(): MicrophoneErrorKind | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure-context'
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported'
  if (typeof AudioContext === 'undefined') return 'unsupported'
  return null
}

/**
 * `boost` turns automatic volume (gain) back on. It can help a very quiet laptop or phone
 * microphone; noise suppression and echo cancellation always stay off.
 */
export async function requestMicrophone({ boost = false } = {}): Promise<MediaStream> {
  const problem = microphoneAvailability()
  if (problem) throw new MicrophoneError(problem)
  const audio = boost ? { ...MUSIC_AUDIO_CONSTRAINTS, autoGainControl: true } : MUSIC_AUDIO_CONSTRAINTS
  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: false })
  } catch (error) {
    throw new MicrophoneError(classifyMicrophoneError(error), error)
  }
}
