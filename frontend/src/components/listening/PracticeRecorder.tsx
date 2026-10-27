import { useEffect, useRef, useState } from 'react'
import type { ListeningState } from '../../audio/useListening'
import { download, recordingFiles, sendToComputer, type RecordingFiles } from '../../audio/saveRecording'
import styles from './ListeningPanel.module.css'

/** Longest diagnostic recording (memory on the phone stays small: ~23 MB at 48 kHz). */
export const MAX_RECORDING_SECONDS = 120

type State =
  | { step: 'idle' }
  | { step: 'recording'; startedAt: number }
  | { step: 'sending' }
  | { step: 'saved'; paths: string[] }
  | { step: 'not-sent'; files: RecordingFiles; reason: string }

function formatSeconds(total: number): string {
  const s = Math.floor(total)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Records a practice run (sound + what the app decided) so detection can be checked against
 * the real guitar. Only runs when the student taps it. The files go to the student's own
 * computer (or are downloaded); nothing is uploaded anywhere else.
 */
export function PracticeRecorder({
  listening,
  title = 'Practice recording (for testing)',
  playHint = 'Play the song as you normally would.',
  startLabel = 'Record this practice',
  maxSeconds = MAX_RECORDING_SECONDS,
}: {
  listening: ListeningState
  title?: string
  playHint?: string
  startLabel?: string
  /** Longest recording; each minute takes about 11.5 MB of the phone's memory. */
  maxSeconds?: number
}) {
  const [state, setState] = useState<State>({ step: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const { status, recording, startRecording, stopRecording } = listening
  const stopping = useRef(false)

  async function finish() {
    if (stopping.current) return
    stopping.current = true
    const result = stopRecording()
    if (!result) {
      setState({ step: 'idle' })
      stopping.current = false
      return
    }
    const files = recordingFiles(result)
    setState({ step: 'sending' })
    try {
      setState({ step: 'saved', paths: await sendToComputer(files) })
    } catch (error) {
      setState({ step: 'not-sent', files, reason: error instanceof Error ? error.message : 'Could not reach the computer.' })
    } finally {
      stopping.current = false
    }
  }

  // Timer, automatic stop at the limit, and saving if listening stopped during the recording.
  useEffect(() => {
    if (state.step !== 'recording') return
    if (!recording) {
      void finish()
      return
    }
    const timer = setInterval(() => {
      const seconds = (performance.now() - state.startedAt) / 1000
      setElapsed(seconds)
      if (seconds >= maxSeconds) void finish()
    }, 250)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, recording])

  function begin() {
    if (startRecording(maxSeconds)) {
      setElapsed(0)
      setState({ step: 'recording', startedAt: performance.now() })
    }
  }

  const canStart = status === 'listening'

  return (
    <div className={styles.recorder}>
      <h3 className={styles.recorderTitle}>{title}</h3>
      {state.step === 'recording' ? (
        <>
          <p role="status">
            <span className={styles.recDot} aria-hidden="true" /> Recording {formatSeconds(elapsed)} of{' '}
            {formatSeconds(maxSeconds)}. {playHint}
          </p>
          <button type="button" className="button button-primary" onClick={() => void finish()}>
            <span aria-hidden="true">■</span> Stop and save
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            Records the sound and what the app decided, so detection can be checked and improved with your guitar.
            The files are saved on your computer only.
          </p>
          <button type="button" className="button" onClick={begin} disabled={!canStart || state.step === 'sending'}>
            <span aria-hidden="true">⏺</span> {startLabel}
          </button>
        </>
      )}

      <div role="status" className={styles.recorderResult}>
        {state.step === 'sending' && <p>Sending to your computer…</p>}
        {state.step === 'saved' && (
          <p className={styles.match}>
            <span aria-hidden="true">✓ </span>Saved on your computer: {state.paths.map((p) => p).join(' and ')}
          </p>
        )}
        {state.step === 'not-sent' && (
          <>
            <p>
              Could not send to the computer ({state.reason}). Download the two files instead, then copy them into the
              project’s <code>recordings</code> folder.
            </p>
            <div className="button-row">
              <button type="button" className="button" onClick={() => download(state.files.wav, `${state.files.baseName}.wav`)}>
                Download sound (.wav)
              </button>
              <button type="button" className="button" onClick={() => download(state.files.json, `${state.files.baseName}.json`)}>
                Download log (.json)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
