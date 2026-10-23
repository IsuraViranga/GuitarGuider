import { MICROPHONE_ERROR_MESSAGES } from '../../audio/microphone'
import type { PitchReading } from '../../audio/pitchTracker'
import type { ListeningState } from '../../audio/useListening'
import { formatFrequency, midiToNoteName } from '../../music/pitch'
import styles from './ListeningPanel.module.css'
import { PracticeRecorder } from './PracticeRecorder'

type ListeningPanelProps = {
  /** The listening session, owned by the practice page (which handles the detected notes). */
  listening: ListeningState
  errorSound: boolean
  onErrorSoundChange: (enabled: boolean) => void
  boost: boolean
  onBoostChange: (enabled: boolean) => void
}

const STATUS_TEXT = {
  idle: 'Not listening.',
  starting: 'Waiting for microphone permission…',
  calibrating: 'Measuring background noise. Please keep quiet for a moment…',
  listening: 'Listening. Play the note.',
  error: 'The microphone is not available.',
} as const


/** Level meter range in decibels: -80 dB (silence) to -10 dB (very loud). */
function levelFraction(rms: number): number {
  const decibels = 20 * Math.log10(Math.max(rms, 1e-6))
  return Math.min(1, Math.max(0, (decibels + 80) / 70))
}

function describeRejection(reading: PitchReading | null): string {
  if (reading?.rejectReason === 'quiet') return 'too quiet: play louder or move the microphone closer'
  if (reading?.rejectReason === 'unclear') return 'sound is not a clear single note'
  return 'nothing clear'
}

/** Microphone controls, what is being heard right now, and detection diagnostics. */
export function ListeningPanel({ listening, errorSound, onErrorSoundChange, boost, onBoostChange }: ListeningPanelProps) {
  const { status, error, autoStopped, reading, stats, start, stop } = listening
  const active = status === 'starting' || status === 'calibrating' || status === 'listening'

  const liveNote = reading?.reliable && reading.midi !== null ? reading : null

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="listening-heading">
      <div className={styles.header}>
        <h2 id="listening-heading">Listening</h2>
        {active ? (
          <button type="button" className="button" onClick={stop}>
            <span aria-hidden="true">❚❚</span> Pause listening
          </button>
        ) : (
          <button type="button" className="button button-primary" onClick={() => start({ boost })}>
            <span aria-hidden="true">🎤</span> {status === 'error' ? 'Try again' : 'Start listening'}
          </button>
        )}
      </div>

      <p role="status" className={styles.status}>
        {STATUS_TEXT[status]}
      </p>

      {status === 'idle' && (
        <>
          <p>
            Put the phone near your guitar. The app listens for the note you play and compares it with the note
            shown above.
          </p>
          <p className="muted">Sound is analysed on this device only. Nothing is recorded or uploaded.</p>
        </>
      )}
      {!active && (
        <label className={styles.option}>
          <input type="checkbox" checked={boost} onChange={(event) => onBoostChange(event.target.checked)} />
          <span>
            Boost a quiet microphone
            <span className="muted"> (try this if the level bar hardly moves while you play)</span>
          </span>
        </label>
      )}
      <label className={styles.option}>
        <input type="checkbox" checked={errorSound} onChange={(event) => onErrorSoundChange(event.target.checked)} />
        <span>Play a short sound when a wrong note is played</span>
      </label>
      {autoStopped && status === 'idle' && (
        <p className="notice">Listening stopped because the app went to the background. Tap “Start listening” to continue.</p>
      )}
      {status === 'error' && error && (
        <p role="alert" className="error-box">
          {MICROPHONE_ERROR_MESSAGES[error]}
        </p>
      )}

      {active && (
        <>
          <div className={styles.live}>
            <span className={styles.liveLabel}>Hearing now</span>
            <span className={styles.liveNote} data-testid="live-note">
              {liveNote ? midiToNoteName(Math.round(liveNote.midi!)).label : '—'}
            </span>
            <span className="muted" data-testid="live-detail">
              {liveNote ? formatFrequency(liveNote.frequency!) : status === 'listening' ? describeRejection(reading) : ''}
            </span>
          </div>
          <div className={styles.meter} aria-hidden="true">
            <div className={styles.meterFill} style={{ width: `${levelFraction(reading?.rms ?? 0) * 100}%` }} />
            {stats && status === 'listening' && (
              <div className={styles.meterGate} style={{ left: `${levelFraction(stats.noiseGate) * 100}%` }} />
            )}
          </div>
        </>
      )}

      {(active || listening.recording) && <PracticeRecorder listening={listening} />}
      {active && stats && <DetectionDetails listening={listening} />}
    </section>
  )
}

function DetectionDetails({ listening }: { listening: ListeningState }) {
  const { reading, stats } = listening
  return (
    <details className={styles.details}>
      <summary>Detection details (for testing)</summary>
      <dl>
        <dt>Frequency</dt>
        <dd>{reading?.frequency ? formatFrequency(reading.frequency) : '—'}</dd>
        <dt>Clarity</dt>
        <dd>{reading ? `${reading.clarity.toFixed(2)} (needs 0.85)` : '—'}</dd>
        <dt>Level / noise gate</dt>
        <dd>
          {reading ? reading.rms.toFixed(4) : '—'} / {stats!.noiseGate.toFixed(4)}
        </dd>
        <dt>Result</dt>
        <dd>{reading?.reliable ? 'clear note' : reading?.rejectReason === 'quiet' ? 'too quiet' : reading?.rejectReason === 'unclear' ? 'unclear' : '—'}</dd>
        <dt>Sample rate</dt>
        <dd>{stats!.sampleRate} Hz</dd>
        <dt>Analysis time</dt>
        <dd>
          {stats!.analysisMs.toFixed(1)} ms per frame, {stats!.framesPerSecond.toFixed(0)} frames/s
        </dd>
      </dl>

    </details>
  )
}
