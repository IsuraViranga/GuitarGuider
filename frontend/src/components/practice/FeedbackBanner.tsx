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
}

function describeCents(cents: number): string {
  const amount = Math.round(Math.abs(cents))
  return `${amount} cents ${cents > 0 ? 'too high' : 'too low'}`
}

/**
 * The result of the last played note. Every state has a symbol and words, never colour alone,
 * and the text is announced politely to screen readers.
 */
export function FeedbackBanner({ practice, notes, listening }: FeedbackBannerProps) {
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
          : `${practice.wrongCount} wrong note${practice.wrongCount === 1 ? '' : 's'} along the way.`}{' '}
        Press Restart to play again.
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
        {feedback.inTune ? ' Now play the next note.' : ` ${stringName} sounds ${describeCents(feedback.cents)}: tune it ${feedback.cents > 0 ? 'down' : 'up'} a little.`}
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
        {feedback.octaveOff && ' Right note name, but in a different octave.'} Try again.
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
