import { Link } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { midiToNoteName } from '../music/pitch'
import { STANDARD_TUNING, STRING_NUMBERS } from '../music/tuning'

const STRING_DESCRIPTIONS: Record<number, string> = {
  1: 'Thinnest string',
  6: 'Thickest string',
}

export function HomePage() {
  usePageTitle('')

  return (
    <div className="page stack">
      <h1>Learn guitar, one note at a time</h1>
      <p>
        Pick a song, play each note on your guitar, and see which note comes next. Songs are written in your
        instructor&apos;s numbering system.
      </p>
      <div className="button-row">
        <Link className="button button-primary" to="/songs">
          Browse songs
        </Link>
        <Link className="button" to="/import">
          Import a song
        </Link>
      </div>

      <section className="card" aria-labelledby="numbers-heading">
        <h2 id="numbers-heading">How the numbers work</h2>
        <p>
          Each note is written as a number. The <strong>first digit is the string</strong>, the{' '}
          <strong>rest is the fret</strong>. Fret 0 means play the string open, with no finger pressing it.
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
    </div>
  )
}
