import { Link } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import stagePhoto from '../assets/brand/melantha-stage.jpg'
import face from '../assets/brand/melantha-face.jpg'
import { midiToNoteName } from '../music/pitch'
import { STANDARD_TUNING, STRING_NUMBERS } from '../music/tuning'
import styles from './HomePage.module.css'

const STRING_DESCRIPTIONS: Record<number, string> = {
  1: 'Thinnest string',
  6: 'Thickest string',
}

export function HomePage() {
  usePageTitle('')

  return (
    <div className="page stack">
      <section className={styles.hero} aria-labelledby="home-heading">
        <div className={styles.heroText}>
          <p className={styles.kicker}>Melantha Guitar Academy</p>
          <h1 id="home-heading" className={styles.title}>
            Learn guitar with <span>Melantha</span>
          </h1>
          <p className={styles.lead}>
            Pick a song, play along note by note or chord by chord, and the app listens and tells you how you are doing.
            Sinhala and English songs.
          </p>
          <div className="button-row">
            <Link className="button button-primary" to="/songs">
              <span aria-hidden="true">🎸</span> Start playing
            </Link>
            <Link className="button" to="/import">
              Add a song
            </Link>
          </div>
        </div>
        <img
          className={styles.heroPhoto}
          src={stagePhoto}
          alt="Melantha on stage with a microphone, under blue stage lights"
          width={400}
          height={808}
        />
      </section>

      <section className={`card ${styles.steps}`} aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol>
          <li>
            <strong>Choose a song</strong>, or paste one from any chord website.
          </li>
          <li>
            <strong>Tap Listen</strong> and put your phone near the guitar.
          </li>
          <li>
            <strong>Play</strong>: green means correct and the song moves on; red shows what to fix.
          </li>
        </ol>
      </section>

      <section className="card" aria-labelledby="numbers-heading">
        <h2 id="numbers-heading">How the numbers work</h2>
        <p>
          Each note is written as a number. The <strong>first digit is the string</strong>, the{' '}
          <strong>rest is the fret</strong>. Fret 0 means play the string open, with no finger pressing it. A chord is
          several numbers in brackets, played together.
        </p>
        <ul>
          <li>
            <code>13</code> = string 1, fret 3
          </li>
          <li>
            <code>60</code> = string 6, open
          </li>
          <li>
            <code>112</code> = string 1, fret 12
          </li>
          <li>
            <code>[40 32 23 12]</code> = D chord
          </li>
        </ul>
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">String numbers in standard tuning</caption>
            <thead>
              <tr>
                <th scope="col">String</th>
                <th scope="col">Open note</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {STRING_NUMBERS.map((stringNumber) => (
                <tr key={stringNumber}>
                  <th scope="row">{stringNumber}</th>
                  <td>{midiToNoteName(STANDARD_TUNING.openStringMidi[stringNumber]).label}</td>
                  <td>{STRING_DESCRIPTIONS[stringNumber] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`card ${styles.meet}`} aria-labelledby="meet-heading">
        <img className={styles.meetPhoto} src={face} alt="Melantha" width={96} height={96} />
        <div>
          <h2 id="meet-heading">Practice tip</h2>
          <p>
            Take it one note at a time. Play slowly until every note turns green, then play it again a little faster.
            Keep your guitar in tune, and enjoy the music.
          </p>
        </div>
      </section>
    </div>
  )
}
