import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { describeNote } from '../songs/describeNote'
import {
  checkImportFile,
  detectFormat,
  FORMAT_LABELS,
  importSongText,
  MAX_TITLE_LENGTH,
  titleFromFileName,
  type ImportResult,
  type SongFileFormat,
} from '../songs/importSong'
import { useSongRepository } from '../songs/songRepository'
import { decodeTextFile } from '../songs/text'
import type { SongIssue, SongNote } from '../songs/types'
import styles from './ImportPage.module.css'

/** An original practice chart (not a real song), to show what a chord chart looks like. */
const EXAMPLE_CHART = [
  'title: My first chord song',
  '',
  'Intro: C  G  Am  F',
  '',
  '[Verse]',
  'C               G',
  'Strum it slowly, one chord at a time',
  'Am              F',
  'Then a little faster, keeping time',
].join('\n')

function issueText(issue: SongIssue): string {
  const where = [issue.line && `Line ${issue.line}`, issue.column && `column ${issue.column}`].filter(Boolean)
  return where.length > 0 ? `${where.join(', ')}: ${issue.message}` : issue.message
}

export function ImportPage() {
  usePageTitle('Add a song')
  const repository = useSongRepository()
  const navigate = useNavigate()

  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [formatOverride, setFormatOverride] = useState<SongFileFormat | 'auto'>('auto')
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const detected = text.trim() ? detectFormat(text) : null
  const format = formatOverride === 'auto' ? detected : formatOverride

  // Any edit makes the previous check out of date.
  const edited = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setResult(null)
    setSaveError(null)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setFileError(null)
    if (!file) return
    const problem = checkImportFile(file)
    if (problem) {
      setFileError(problem)
      event.target.value = ''
      return
    }
    try {
      const content = decodeTextFile(await file.arrayBuffer())
      if (content === null) {
        setFileError('The file could not be read as text. In your editor, save it as "UTF-8" and try again.')
        event.target.value = ''
        return
      }
      edited(setText)(content)
      if (!title) setTitle(titleFromFileName(file.name))
    } catch {
      setFileError('The file could not be read.')
    }
  }

  function handleCheck(event: FormEvent) {
    event.preventDefault()
    setResult(importSongText(text, formatOverride, title))
  }

  async function handleSave() {
    if (!result?.ok) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await repository.saveImportedSong(result.song)
      navigate(`/songs/${saved.id}/practice`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The song could not be saved.')
      setSaving(false)
    }
  }

  const simplified = result?.ok ? [...new Set(result.song.notes.map((n) => n.chord?.simplifiedFrom).filter(Boolean))] : []

  return (
    <div className="page stack">
      <h1>Add a song</h1>
      <p>
        Copy a song from any website and paste it below: a <strong>chord chart</strong> (chord names above the words), a{' '}
        <strong>guitar tab</strong>, or your instructor&apos;s numbers. The app works out which it is and turns it into
        guitar numbers for you.
      </p>

      <form className="stack" onSubmit={handleCheck} noValidate>
        <div className="field">
          <label htmlFor="import-text" className={styles.bigLabel}>
            Paste the song here
          </label>
          <textarea
            id="import-text"
            className={`mono ${styles.paste}`}
            rows={10}
            value={text}
            onChange={(event) => edited(setText)(event.target.value)}
            spellCheck={false}
            placeholder={'C              G\nWords of the song…'}
            aria-describedby="import-format"
          />
          <p id="import-format" className={styles.detected} role="status">
            {format ? (
              <>
                <span aria-hidden="true">✓ </span>Recognised as: <strong>{FORMAT_LABELS[format]}</strong>
              </>
            ) : (
              <>
                Nothing to try?{' '}
                <button type="button" className="button" onClick={() => edited(setText)(EXAMPLE_CHART)}>
                  Paste an example chord chart
                </button>
              </>
            )}
          </p>
          {text.trim() && (
            <details className={styles.override}>
              <summary>Not recognised correctly?</summary>
              <label htmlFor="import-format-choice">Read it as</label>
              <select
                id="import-format-choice"
                value={formatOverride}
                onChange={(event) => edited(setFormatOverride)(event.target.value as SongFileFormat | 'auto')}
              >
                <option value="auto">Automatic</option>
                {(Object.keys(FORMAT_LABELS) as SongFileFormat[]).map((key) => (
                  <option key={key} value={key}>
                    {FORMAT_LABELS[key]}
                  </option>
                ))}
              </select>
            </details>
          )}
        </div>

        <div className="field">
          <label htmlFor="import-file">Or choose a text file</label>
          <input id="import-file" type="file" accept=".txt,.tab,.cho,.chopro,.chordpro,.pro,text/plain" onChange={handleFile} />
          {fileError && (
            <p role="alert" className="error-box">
              {fileError}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="import-title">Song title</label>
          <input
            id="import-title"
            type="text"
            maxLength={MAX_TITLE_LENGTH}
            value={title}
            onChange={(event) => edited(setTitle)(event.target.value)}
            aria-describedby="import-title-help"
          />
          <p id="import-title-help" className="muted">
            Sinhala titles are fine. Leave empty if the pasted text has a <code>title:</code> line.
          </p>
        </div>

        <div className="button-row">
          <button type="submit" className="button button-primary" disabled={!text.trim()}>
            Check song
          </button>
        </div>
      </form>

      {result && !result.ok && (
        <div className="error-box" role="alert">
          <h2>{result.issues.length === 1 ? 'Something needs fixing' : `${result.issues.length} things need fixing`}</h2>
          <ul>
            {result.issues.map((issue, i) => (
              <li key={i}>{issueText(issue)}</li>
            ))}
          </ul>
        </div>
      )}

      {result?.ok && (
        <section className="card stack" aria-labelledby="preview-heading">
          <h2 id="preview-heading">
            “{result.song.title}”: {stepSummary(result.song.notes)}
          </h2>
          <p role="status">Here is the song in guitar numbers. If it looks right, save it and start practising.</p>
          {simplified.length > 0 && (
            <p className="notice">
              Some chords were made easier to play: {simplified.join('; ')}.
            </p>
          )}
          <SongPreview notes={result.song.notes} />
          {saveError && (
            <p role="alert" className="error-box">
              {saveError}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save and practise'}
            </button>
          </div>
          <p className="muted">Songs you add are saved in this browser until accounts are added.</p>
        </section>
      )}
    </div>
  )
}

function stepSummary(notes: readonly SongNote[]): string {
  const chords = notes.filter((n) => n.chord).length
  const singles = notes.length - chords
  return [chords && `${chords} chord${chords === 1 ? '' : 's'}`, singles && `${singles} note${singles === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' and ')
}

/** Every step as it will be practised: chord name or note, its guitar numbers, and the words. */
function SongPreview({ notes }: { notes: readonly SongNote[] }) {
  return (
    <ol className={styles.preview}>
      {notes.map((note) => {
        const text = describeNote(note)
        return (
          <li key={note.index} className={styles.step}>
            <span className={styles.stepName}>{note.chord ? (note.chord.name ?? 'Chord') : text.number}</span>
            <span className={styles.stepNumbers}>{note.chord ? text.number : text.noteName}</span>
            {note.lyric && <span className={styles.stepLyric}>{note.lyric}</span>}
          </li>
        )
      })}
    </ol>
  )
}
