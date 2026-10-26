import styles from './LineBreak.module.css'

/**
 * Starts a new row for the next line of the sheet, showing its number. Used inside lists of notes
 * (a flex-wrap <ol>). Decorative: each note also says its line to screen readers.
 */
export function LineBreak({ line, className }: { line: number; className?: string }) {
  return (
    <li role="presentation" aria-hidden="true" className={[styles.break, line % 2 === 0 && styles.even, className].filter(Boolean).join(' ')}>
      <span>Line {line}</span>
    </li>
  )
}
