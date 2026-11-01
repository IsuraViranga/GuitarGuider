import type { SoundMatchState } from './useSoundMatch'
import styles from './Dataset.module.css'

/** The admin's choice on the practice page; nothing for anyone else or before a guitar is prepared. */
export function SoundMatchChoice({ state }: { state: SoundMatchState }) {
  if (state.guitars.length === 0) return null
  return (
    <label className={styles.soundMatchChoice}>
      <span>
        <span aria-hidden="true">🎙 </span>Compare with recorded guitar <span className="muted">(admin test)</span>
      </span>
      <select className={styles.select} value={state.chosenId ?? ''} onChange={(e) => state.choose(e.target.value || null)}>
        <option value="">Off</option>
        {state.guitars.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  )
}
