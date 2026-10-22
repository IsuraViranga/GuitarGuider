import { useEffect, useRef } from 'react'
import { describeNote, noteAccessibleLabel } from '../../songs/describeNote'
import type { SongNote } from '../../songs/types'
import styles from './NoteTimeline.module.css'

type NoteTimelineProps = {
  notes: readonly SongNote[]
  /** -1 when no note is current (e.g. an import preview) */
  currentIndex: number
  /** When omitted the timeline is read-only. */
  onSelect?: (index: number) => void
}

/** Every note in the song. When selectable, choosing one jumps practice to that note. */
export function NoteTimeline({ notes, currentIndex, onSelect }: NoteTimelineProps) {
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
        const className = [
          styles.note,
          isCurrent && styles.current,
          note.index < currentIndex && styles.past,
          !onSelect && styles.readOnly,
        ]
          .filter(Boolean)
          .join(' ')
        const content = (
          <>
            <span className="visually-hidden">{noteAccessibleLabel(note, notes.length)}</span>
            <span className={styles.position} aria-hidden="true">
              {isCurrent ? '▶ ' : ''}
              {note.index + 1}
            </span>
            <span className={styles.number} aria-hidden="true">
              {text.number}
            </span>
            <span className={styles.noteName} aria-hidden="true">
              {text.noteName}
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
