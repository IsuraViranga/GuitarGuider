import { useReducer } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { Fretboard } from '../components/fretboard/Fretboard'
import { NoteTimeline } from '../components/timeline/NoteTimeline'
import { STANDARD_TUNING, getTuning } from '../music/tuning'
import { describeNote, noteAccessibleLabel } from '../songs/describeNote'
import type { Song } from '../songs/types'
import { useSong } from '../songs/useSong'
import { validateSong } from '../songs/validation'
import {
  createPracticeState,
  isFirstNote,
  isLastNote,
  practiceReducer,
} from '../practice/practiceReducer'
import { SongStatus } from './SongStatus'
import styles from './PracticePage.module.css'

export function PracticePage() {
  const { songId } = useParams()
  const state = useSong(songId)
  const song = state.status === 'ready' ? state.value : undefined
  usePageTitle(song ? `Practise ${song.title}` : 'Practice')

  if (!song) return <SongStatus state={state} />
  if (validateSong(song).length > 0) {
    return (
      <div className="page stack">
        <h1>{song.title}</h1>
        <p className="error-box" role="alert">
          This song has problems that must be fixed before practice.{' '}
          <Link to={`/songs/${song.id}`}>See the details</Link>.
        </p>
      </div>
    )
  }
  return <PracticeView key={song.id} song={song} />
}

function PracticeView({ song }: { song: Song }) {
  const [practice, dispatch] = useReducer(practiceReducer, song.notes.length, createPracticeState)
  const tuning = getTuning(song.tuningId) ?? STANDARD_TUNING
  const note = song.notes[practice.currentIndex]
  const text = describeNote(note)

  return (
    <div className={`page ${styles.layout}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>{song.title}</h1>
        <p className={styles.progress} data-testid="progress">
          Note <strong>{practice.currentIndex + 1}</strong> of {song.notes.length}
        </p>
      </header>

      {/* Announces the new target to screen readers whenever the position changes. */}
      <p role="status" className="visually-hidden">
        {noteAccessibleLabel(note, song.notes.length)}
        {isLastNote(practice) ? '. Last note.' : ''}
      </p>

      <section className={`card ${styles.target}`} aria-labelledby="target-heading">
        <h2 id="target-heading" className={styles.targetHeading}>
          Play next
        </h2>
        <p className={styles.number} data-testid="expected-number">
          {text.number}
        </p>
        <p className={styles.targetDetails}>
          <span>{text.position}</span>
          <span>
            Note <strong>{text.noteName}</strong> · {text.frequency}
          </span>
        </p>
        <Fretboard position={note.position} tuning={tuning} />
      </section>

      <div className={styles.controls} role="group" aria-label="Song position">
        <button
          type="button"
          className="button"
          onClick={() => dispatch({ type: 'previous' })}
          disabled={isFirstNote(practice)}
        >
          <span aria-hidden="true">◀</span> Back
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => dispatch({ type: 'next' })}
          disabled={isLastNote(practice)}
        >
          Next <span aria-hidden="true">▶</span>
        </button>
        <button
          type="button"
          className="button"
          onClick={() => dispatch({ type: 'reset' })}
          disabled={isFirstNote(practice)}
        >
          <span aria-hidden="true">↺</span> Restart
        </button>
      </div>

      <section className={`notice ${styles.listening}`} aria-labelledby="listening-heading">
        <h2 id="listening-heading">Listening</h2>
        <p>
          Listening through the microphone is not available yet (it is the next development phase). For now, read
          the notes and move through the song with the buttons or by choosing a note below.
        </p>
      </section>

      <section className={styles.timeline} aria-labelledby="timeline-heading">
        <h2 id="timeline-heading">All notes</h2>
        <p className="muted">Choose any note to jump to it.</p>
        <NoteTimeline
          notes={song.notes}
          currentIndex={practice.currentIndex}
          onSelect={(index) => dispatch({ type: 'jumpTo', index })}
        />
      </section>
    </div>
  )
}
