import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { midiToNoteName } from '../../music/pitch'
import type { StepRecord, WrongTry } from '../../practice/practiceReducer'
import { shortLabel } from '../../songs/describeNote'
import { startsLine } from '../../songs/lines'
import { LineBreak } from '../timeline/LineBreak'
import type { SongNote } from '../../songs/types'
import styles from './PlayedStrip.module.css'

type PlayedStripProps = {
  notes: readonly SongNote[]
  record: readonly StepRecord[]
  currentIndex: number
  completed: boolean
  /** Jump to a note (to practise a red one again). Without it the notes are only shown (My progress). */
  onSelect?: (index: number) => void
  /** Shown under the heading (the practice page puts "Save this practice" here). */
  children?: ReactNode
}

type Status = 'right' | 'mistake' | 'skipped' | 'current'

/** A step with any wrong try stays red, even after it was played right. */
export function stepStatus(step: StepRecord, isCurrent: boolean): Status | null {
  if (step.wrong.length > 0) return 'mistake'
  if (step.result === 'correct') return 'right'
  if (step.result === 'skipped') return 'skipped'
  return isCurrent ? 'current' : null
}

/** What was heard instead, e.g. "G4" or, for a chord, "G" ("?" if it could not be named). */
export function heardLabels(wrong: readonly WrongTry[]): string[] {
  const labels = wrong.map((w) => ('heardMidi' in w ? midiToNoteName(Math.round(w.heardMidi)).label : (w.heardChord ?? '?')))
  return [...new Set(labels)]
}

function describeStep(step: StepRecord, status: Status): string {
  if (status === 'right') return 'right first time'
  if (status === 'skipped') return 'skipped'
  if (status === 'current') return 'playing now'
  const times = step.wrong.length === 1 ? '1 time' : `${step.wrong.length} times`
  const after = step.result === 'correct' ? 'then right' : 'not played right yet'
  return `wrong ${times} (played ${heardLabels(step.wrong).join(', ')}), ${after}`
}

/**
 * The student's own playing, step by step: green when right first time, red when there was a
 * mistake (with what was played instead), grey when skipped. Kept after the song is complete.
 */
export function PlayedStrip({ notes, record, currentIndex, completed, onSelect, children }: PlayedStripProps) {
  const listRef = useRef<HTMLOListElement>(null)
  const shown = notes
    .map((note) => ({ note, step: record[note.index], status: stepStatus(record[note.index], !completed && note.index === currentIndex) }))
    .filter((item): item is { note: SongNote; step: StepRecord; status: Status } => item.status !== null)
  const right = shown.filter((s) => s.status === 'right').length
  const mistakes = shown.filter((s) => s.status === 'mistake').length
  const skipped = shown.filter((s) => s.status === 'skipped').length
  // Until the first note is played, a short explanation instead of a lone "now playing" chip.
  const started = shown.some((s) => s.status !== 'current')

  // Keep the newest notes in view (inside the list only; the page does not move).
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [shown.length])

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="played-heading">
      <div className={styles.header}>
        <h2 id="played-heading" className={styles.title}>
          What you played
        </h2>
        {started && (
          <p className={styles.summary} data-testid="played-summary">
            <span className={styles.sumRight}>✓ {right} right</span>
            {mistakes > 0 && <span className={styles.sumMistake}>✗ {mistakes} to practise</span>}
            {skipped > 0 && <span className={styles.sumSkipped}>{skipped} skipped</span>}
          </p>
        )}
      </div>
      {children}
      {!started ? (
        <p className={styles.empty}>Your notes appear here as you play: green when right, red when there was a mistake.</p>
      ) : (
        <ol ref={listRef} className={styles.list} data-testid="played-list">
          {shown.map(({ note, step, status }, k) => {
            const previous = shown[k - 1]?.note
            const newLine = startsLine(note, previous)
            // Songs without sheet lines: a small gap where a new measure starts (as before).
            const newMeasure = !newLine && k > 0 && note.measure !== undefined && note.measure !== previous?.measure
            const label = shortLabel(note)
            return (
              <Fragment key={note.index}>
              {newLine && <LineBreak line={note.line!} className={styles.lineBreak} />}
              <li className={newMeasure ? styles.lineStart : undefined}>
                <Chip
                  className={`${styles.chip} ${styles[status]} ${note.index === currentIndex && !completed ? styles.now : ''} ${onSelect ? '' : styles.readOnly}`}
                  onSelect={onSelect ? () => onSelect(note.index) : undefined}
                  label={`Note ${note.index + 1}, ${label}${note.lyric ? ` (${note.lyric})` : ''}: ${describeStep(step, status)}`}
                  status={status}
                >
                  <span className={styles.number}>{label}</span>
                  {note.lyric && (
                    <span className={styles.lyric} title={note.lyric}>
                      {note.lyric}
                    </span>
                  )}
                  <span className={styles.mark} aria-hidden="true">
                    {status === 'right' && '✓'}
                    {status === 'mistake' && `✗${step.wrong.length}`}
                    {status === 'skipped' && '–'}
                    {status === 'current' && '▶'}
                  </span>
                  {status === 'mistake' && (
                    <span className={styles.heard} aria-hidden="true">
                      you: {heardLabels(step.wrong).slice(0, 2).join(', ')}
                      {heardLabels(step.wrong).length > 2 ? '…' : ''}
                    </span>
                  )}
                </Chip>
              </li>
              </Fragment>
            )
          })}
        </ol>
      )}
      {mistakes > 0 && onSelect && <p className={styles.hint}>Tap a red note to practise it again.</p>}
    </section>
  )
}

/** A note chip: a button that jumps to the note, or (read-only) a labelled box. */
function Chip({ className, onSelect, label, status, children }: { className: string; onSelect?: () => void; label: string; status: Status; children: ReactNode }) {
  if (onSelect) {
    return (
      <button type="button" className={className} onClick={onSelect} aria-label={label} data-status={status}>
        {children}
      </button>
    )
  }
  return (
    <span className={className} role="img" aria-label={label} data-status={status}>
      {children}
    </span>
  )
}
