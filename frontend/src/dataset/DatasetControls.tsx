import { useId, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { addGuitar, type DatasetGuitar, type GuitarType, type StringMaterial } from './datasetApi'
import { DEFAULT_WOUND, defaultMaterial } from './pluck'
import styles from './Dataset.module.css'

/** One choice from a few, as big tappable chips (radio buttons underneath). */
export function ChoiceChips<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  disabled = false,
}: {
  legend: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const name = useId()
  return (
    <fieldset className={styles.choice} disabled={disabled}>
      <legend>{legend}</legend>
      <div className={styles.chips}>
        {options.map((option) => (
          <label key={String(option.value)} className={styles.chip}>
            <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const GUITAR_TYPES: { value: GuitarType; label: string }[] = [
  { value: 'acoustic', label: 'Acoustic' },
  { value: 'classical', label: 'Classical' },
  { value: 'electric', label: 'Electric' },
  { value: 'other', label: 'Other' },
]

const MATERIALS: { value: StringMaterial; label: string }[] = [
  { value: 'steel', label: 'Steel' },
  { value: 'nylon', label: 'Nylon' },
  { value: 'unknown', label: 'Not sure' },
]

/** Adding a guitar: done once per guitar, then it is chosen from the list. */
export function GuitarForm({ onAdded, onCancel }: { onAdded: (guitar: DatasetGuitar) => void; onCancel?: () => void }) {
  const [name, setName] = useState('')
  const [guitarType, setGuitarType] = useState<GuitarType>('acoustic')
  const [stringMaterial, setStringMaterial] = useState<StringMaterial>('steel')
  const [wound, setWound] = useState<number[] | null>(DEFAULT_WOUND.acoustic)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()

  const chooseType = (type: GuitarType) => {
    setGuitarType(type)
    setStringMaterial(defaultMaterial(type))
    setWound(DEFAULT_WOUND[type])
  }
  const toggle = (string: number) => setWound((current) => (current ?? []).includes(string) ? (current ?? []).filter((s) => s !== string) : [...(current ?? []), string].sort())

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onAdded(await addGuitar({ name, guitarType, stringMaterial, woundStrings: wound }))
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'Could not add the guitar. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.guitarForm} onSubmit={submit} aria-label="Add a guitar">
      <div className="field">
        <label htmlFor={nameId}>Guitar name</label>
        <input id={nameId} type="text" value={name} maxLength={60} placeholder="e.g. Yamaha black" onChange={(e) => setName(e.target.value)} required />
      </div>
      <ChoiceChips legend="Type" options={GUITAR_TYPES} value={guitarType} onChange={chooseType} />
      <ChoiceChips legend="Strings" options={MATERIALS} value={stringMaterial} onChange={setStringMaterial} />
      <fieldset className={styles.choice}>
        <legend>Wound strings</legend>
        <div className={styles.chips}>
          {[1, 2, 3, 4, 5, 6].map((s) => (
            <label key={s} className={styles.chip}>
              <input type="checkbox" checked={wound?.includes(s) ?? false} disabled={wound === null} onChange={() => toggle(s)} />
              <span>{s}</span>
            </label>
          ))}
          <label className={styles.chip}>
            <input type="checkbox" checked={wound === null} onChange={() => setWound(wound === null ? DEFAULT_WOUND[guitarType] : null)} />
            <span>Not sure</span>
          </label>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="button button-primary" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add guitar'}
        </button>
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
