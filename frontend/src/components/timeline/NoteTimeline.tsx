import { useEffect, useRef } from 'react'
import { describeNote, noteAccessibleLabel, shortLabel } from '../../songs/describeNote'
import type { StepRecord } from '../../practice/practiceReducer'
import type { SongNote } from '../../songs/types'
import { stepStatus } from '../practice/PlayedStrip'
import styles from './NoteTimeline.module.css'

type NoteTimelineProps = {
  notes: readonly SongNote[]
  /** -1 when no note is current (e.g. an import preview) */
  currentIndex: number
  /** When omitted the timeline is read-only. */
  onSelect?: (index: number) => void
  /** What the student played at each step (practice): notes are marked right, mistake or skipped. */
  record?: readonly StepRecord[]
}

const RESULT_WORDS = { right: 'right first time', mistake: 'had a mistake', skipped: 'skipped' } as const

/** Every note in the song. When selectable, choosing one jumps practice to that note. */
export function NoteTimeline({ notes, currentIndex, onSelect, record }: NoteTimelineProps) {
  const listRef = useRef<HTMLOListElement>(null)
  const currentRef = useRef<HTMLButtonElement>(null)

  // Keep the current note visible inside the list's own scroll area. Unlike scrollIntoView,
  // this never scrolls the page, so the "Play next" card stays on screen on phones.
  useEffect(() => {
    const list = listRef.current
    const item = currentRef.current
    if (!list || !item) return
    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top - 8
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8
  }, [currentIndex])

  return (
    <ol ref={listRef} className={styles.timeline}>
      {notes.map((note) => {
        const isCurrent = note.index === currentIndex
        const startsMeasure = note.index > 0 && note.measure !== notes[note.index - 1].measure
        const text = describeNote(note)
        const status = record ? stepStatus(record[note.index], false) : null
        const result = status === 'right' || status === 'mistake' || status === 'skipped' ? status : null
        const className = [
          styles.note,
          isCurrent && styles.current,
          note.index < currentIndex && styles.past,
          result && !isCurrent && styles[result],
          !onSelect && styles.readOnly,
        ]
          .filter(Boolean)
          .join(' ')
        const content = (
          <>
            <span className="visually-hidden">
              {noteAccessibleLabel(note, notes.length)}
              {note.lyric ? `, words: ${note.lyric}` : ''}
              {result ? `, ${RESULT_WORDS[result]}` : ''}
            </span>
            <span className={styles.position} aria-hidden="true">
              {isCurrent ? '▶ ' : ''}
              {note.index + 1}
            </span>
            <span className={styles.number} aria-hidden="true">
              {shortLabel(note)}
            </span>
            {note.lyric && (
              <span className={styles.lyric} aria-hidden="true" title={note.lyric}>
                {note.lyric}
              </span>
            )}
            <span className={styles.noteName} aria-hidden="true">
              {note.chord ? 'chord' : text.noteName}
            </span>
          </>
        )
        return (
          <li key={note.index} className={startsMeasure ? styles.measureStart : undefined}>
            {onSelect ? (
              <button
                ref={isCurrent ? currentRef : undefined}
                type="button"
                className={className}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => onSelect(note.index)}
              >
                {content}
              </button>
            ) : (
              <span className={className}>{content}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
