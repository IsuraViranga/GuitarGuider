import { Link } from 'react-router-dom'
import type { SoundMatchState, SoundMatchStatus } from './useSoundMatch'
import styles from './Dataset.module.css'

/** What the string check does with recorded guitars, in plain words. */
function describe(status: SoundMatchStatus): string {
  switch (status.kind) {
    case 'loading':
      return 'Loading the recorded guitars…'
    case 'off':
      return 'Off: the string check uses your guitar setup only.'
    case 'using':
      return `✓ Using ${status.guitar.name}: same-sounding places (like 10 and 25) are checked with its recordings.`
    case 'normal':
      return 'The string check uses your guitar setup.'
  }
}

/**
 * The guitar the string check compares with (signed-in players): the default, any recorded guitar,
 * or off, and a way to record their own. Nothing for visitors.
 */
export function GuitarChoice({ state }: { state: SoundMatchState }) {
  if (!state.available) return null
  const fallback = state.guitars.find((g) => g.isDefault)
  const hasOwn = state.guitars.some((g) => g.mine)
  return (
    <section id="guitar-choice" className={`card ${styles.guitarChoice}`} aria-label="Guitar for the string check">
      <label className={styles.guitarChoiceLabel}>
        <span>
          <span aria-hidden="true">🎸 </span>Guitar for the string check
        </span>
        <select className={styles.select} value={state.choice} onChange={(e) => state.choose(e.target.value)}>
          <option value="">{fallback ? `Default (${fallback.name})` : 'Default'}</option>
          {state.guitars.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · {g.mine ? 'yours' : `by ${g.ownerName ?? 'a player'}`}
            </option>
          ))}
          <option value="off">Off</option>
        </select>
      </label>
      <p className={`muted ${styles.guitarChoiceStatus}`} role="status" data-testid="guitar-choice-status">
        {describe(state.status)}
      </p>
      <Link to="/record-guitar" className={styles.recordLink}>
        {hasOwn ? '🎙 Record another guitar' : '🎙 Record my guitar (about 15 min, once)'}
      </Link>
    </section>
  )
}
