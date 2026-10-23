import type { ReactNode } from 'react'
import { formatFrequency, midiToFrequency, midiToNoteName } from '../../music/pitch'
import { describeNote } from '../../songs/describeNote'
import type { SongNote } from '../../songs/types'
import type { PracticeState } from '../../practice/practiceReducer'
import styles from './FeedbackBanner.module.css'

type FeedbackBannerProps = {
  practice: PracticeState
  notes: readonly SongNote[]
  listening: boolean
  onRestart: () => void
}

/**
 * Strings 1 and 6 are both E: the same fret on the wrong one sounds exactly two octaves away.
 * Beginners easily mix them up (string 6 is on top when you look down at the guitar).
 */
function wrongStringHint(expected: SongNote, heardMidi: number): string | null {
  const string = expected.position?.stringNumber
  if (string === 1 && heardMidi === expected.midi - 24) {
    return 'That sounds like string 6 (the thickest). Use string 1, the thinnest string.'
  }
  if (string === 6 && heardMidi === expected.midi + 24) {
    return 'That sounds like string 1 (the thinnest). Use string 6, the thickest string.'
  }
  return null
}

function describeCents(cents: number): string {
  const amount = Math.round(Math.abs(cents))
  return `${amount} cents ${cents > 0 ? 'too high' : 'too low'}`
}

/**
 * The result of the last played note. Every state has a symbol and words, never colour alone,
 * and the text is announced politely to screen readers.
 */
export function FeedbackBanner({ practice, notes, listening, onRestart }: FeedbackBannerProps) {
  const { feedback, completed } = practice
  let kind: 'neutral' | 'correct' | 'incorrect' | 'complete' = 'neutral'
  let symbol = ''
  let message: ReactNode

  if (completed) {
    kind = 'complete'
    symbol = '★'
    message = (
      <>
        <strong>Song complete. Well done!</strong>{' '}
        {practice.wrongCount === 0
          ? 'No wrong notes.'
          : `${practice.wrongCount} wrong note${practice.wrongCount === 1 ? '' : 's'} along the way.`}
        {practice.skippedCount > 0 && ` ${practice.skippedCount} skipped.`}{' '}
        <button type="button" className={`button button-primary ${styles.again}`} onClick={onRestart}>
          <span aria-hidden="true">↺</span> Play again
        </button>
      </>
    )
  } else if (feedback.kind === 'correct') {
    kind = 'correct'
    symbol = '✓'
    const playedNote = notes[feedback.noteIndex]
    const played = describeNote(playedNote)
    const stringName = playedNote.position ? `String ${playedNote.position.stringNumber}` : 'Your guitar'
    message = (
      <>
        <strong>Correct!</strong> {played.number} ({played.noteName}).
        {feedback.skipped > 0 && ` (Caught up: ${feedback.skipped} note${feedback.skipped === 1 ? '' : 's'} skipped.)`}
        {feedback.inTune
          ? notes[feedback.noteIndex + 1] && describeNote(notes[feedback.noteIndex + 1]).number === played.number
            ? ' Now play it again.'
            : ' Now play the next note.'
          : ` ${stringName} sounds ${describeCents(feedback.cents)}: tune it ${feedback.cents > 0 ? 'down' : 'up'} a little.`}
      </>
    )
  } else if (feedback.kind === 'incorrect') {
    kind = 'incorrect'
    symbol = '✗'
    const expected = describeNote(notes[feedback.noteIndex])
    message = (
      <>
        <strong>Not this note.</strong> Expected {expected.number} ({expected.noteName}), heard{' '}
        {midiToNoteName(feedback.heardMidi).label} ({formatFrequency(midiToFrequency(feedback.detectedMidi))}).
        {' '}
        {wrongStringHint(notes[feedback.noteIndex], feedback.heardMidi) ??
          (feedback.octaveOff ? 'Right note name, but in a different octave.' : '')}{' '}
        Try again.
      </>
    )
  } else {
    message = listening ? 'Play the note shown below.' : 'Start listening, then play the note shown below.'
  }

  return (
    <div className={`${styles.banner} ${styles[kind]}`} data-testid="feedback" data-kind={kind}>
      {symbol && (
        <span className={styles.symbol} aria-hidden="true">
          {symbol}
        </span>
      )}
      <p role="status" className={styles.message}>
        {message}
      </p>
    </div>
  )
}
