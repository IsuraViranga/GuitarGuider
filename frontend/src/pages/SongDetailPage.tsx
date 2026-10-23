import { Link, useParams } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { PageBanner } from '../components/decor/PageBanner'
import { describeNote, songSourceLabel } from '../songs/describeNote'
import { getTuning } from '../music/tuning'
import { useSong } from '../songs/useSong'
import { validateSong } from '../songs/validation'
import { SongStatus } from './SongStatus'

export function SongDetailPage() {
  const { songId } = useParams()
  const state = useSong(songId)
  const song = state.status === 'ready' ? state.value : undefined
  usePageTitle(song?.title ?? 'Song')

  if (!song) return <SongStatus state={state} />

  const issues = validateSong(song)
  const hasMeasures = song.notes.some((note) => note.measure !== undefined)
  const hasLyrics = song.notes.some((note) => note.lyric)

  return (
    <div className="page stack">
      <PageBanner kicker="Song" title={song.title} headingId="song-heading">
        {song.description && <p>{song.description}</p>}
      </PageBanner>
      <p className="muted">
        {song.notes.length} notes · {getTuning(song.tuningId)?.name ?? song.tuningId}
        {song.difficulty && ` · ${song.difficulty}`} · {songSourceLabel(song.source)}
      </p>

      {issues.length > 0 ? (
        <div className="error-box" role="alert">
          <h2>This song can&apos;t be practised yet</h2>
          <ul>
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="button-row">
          <Link className="button button-primary" to={`/songs/${song.id}/practice`}>
            Start practice
          </Link>
        </div>
      )}

      <section aria-labelledby="arrangement-heading">
        <h2 id="arrangement-heading">Arrangement</h2>
        <div className="table-scroll card">
          <table>
            <thead>
              <tr>
                <th scope="col">#</th>
                {hasMeasures && <th scope="col">Measure</th>}
                <th scope="col">Number</th>
                <th scope="col">Position</th>
                <th scope="col">Note</th>
                <th scope="col">Frequency</th>
                {hasLyrics && <th scope="col">Words</th>}
              </tr>
            </thead>
            <tbody>
              {song.notes.map((note) => {
                const text = describeNote(note)
                return (
                  <tr key={note.index}>
                    <td>{note.index + 1}</td>
                    {hasMeasures && <td>{note.measure ?? ''}</td>}
                    <td>
                      <strong>{text.number}</strong>
                    </td>
                    <td>{text.position}</td>
                    <td>{text.noteName}</td>
                    <td>{text.frequency}</td>
                    {hasLyrics && <td>{note.lyric ?? ''}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
