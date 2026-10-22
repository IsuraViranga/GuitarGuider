import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { NoteTimeline } from '../components/timeline/NoteTimeline'
import {
  checkImportFile,
  importSongText,
  looksLikeAsciiTab,
  MAX_TITLE_LENGTH,
  titleFromFileName,
  type ImportResult,
  type SongFileFormat,
} from '../songs/importSong'
import { useSongRepository } from '../songs/songRepository'
import { decodeTextFile } from '../songs/text'
import type { SongIssue } from '../songs/types'

const EXAMPLES: Record<SongFileFormat, string> = {
  'guitar-numbers': ['title: My First Tune', '# "|" separates measures (optional)', '10 11 13 11 | 10 21 20'].join('\n'),
  'ascii-tab': [
    'title: My First Tab',
    'e|-----0-1-3-|',
    'B|-1-3-------|',
    'G|-----------|',
    'D|-----------|',
    'A|-----------|',
    'E|-----------|',
  ].join('\n'),
}

function issueText(issue: SongIssue): string {
  const where = [issue.line && `Line ${issue.line}`, issue.column && `column ${issue.column}`].filter(Boolean)
  return where.length > 0 ? `${where.join(', ')}: ${issue.message}` : issue.message
}

export function ImportPage() {
  usePageTitle('Import a song')
  const repository = useSongRepository()
  const navigate = useNavigate()

  const [format, setFormat] = useState<SongFileFormat>('guitar-numbers')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
      if (looksLikeAsciiTab(content)) setFormat('ascii-tab')
    } catch {
      setFileError('The file could not be read.')
    }
  }

  function handleCheck(event: FormEvent) {
    event.preventDefault()
    setResult(importSongText(text, format, title))
  }

  async function handleSave() {
    if (!result?.ok) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await repository.saveImportedSong(result.song)
      navigate(`/songs/${saved.id}`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The song could not be saved.')
      setSaving(false)
    }
  }

  return (
    <div className="page stack">
      <h1>Import a song</h1>
      <p>
        Load a plain-text file with the song&apos;s notes, or paste them below. Only single notes are supported for now
        (no chords). Audio recordings such as MP3 files cannot be imported.
      </p>

      <form className="stack" onSubmit={handleCheck} noValidate>
        <fieldset>
          <legend>File format</legend>
          <label className="radio-option">
            <input
              type="radio"
              name="format"
              value="guitar-numbers"
              checked={format === 'guitar-numbers'}
              onChange={() => edited(setFormat)('guitar-numbers')}
            />
            Guitar numbers (for example <code>10 11 13</code>)
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="format"
              value="ascii-tab"
              checked={format === 'ascii-tab'}
              onChange={() => edited(setFormat)('ascii-tab')}
            />
            ASCII guitar tab (6 lines, <code>e|---0---|</code>)
          </label>
        </fieldset>

        <div className="field">
          <label htmlFor="import-file">Choose a text file (.txt or .tab, up to 100 KB)</label>
          <input id="import-file" type="file" accept=".txt,.tab,text/plain" onChange={handleFile} />
          {fileError && (
            <p role="alert" className="error-box">
              {fileError}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="import-text">Song notes</label>
          <textarea
            id="import-text"
            className="mono"
            rows={9}
            value={text}
            onChange={(event) => edited(setText)(event.target.value)}
            spellCheck={false}
            aria-describedby="import-text-help"
          />
          <p id="import-text-help" className="muted">
            Not sure what to write?{' '}
            <button
              type="button"
              className="button"
              onClick={() => edited(setText)(EXAMPLES[format])}
            >
              Insert an example
            </button>
          </p>
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
            Leave empty to use the file&apos;s <code>title:</code> line.
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
          <h2>The song has {result.issues.length === 1 ? 'a problem' : `${result.issues.length} problems`}</h2>
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
            “{result.song.title}”: {result.song.notes.length} notes found
          </h2>
          <p role="status">The song is valid. Check the notes below, then save it.</p>
          <NoteTimeline notes={result.song.notes} currentIndex={-1} />
          {saveError && (
            <p role="alert" className="error-box">
              {saveError}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save to my songs'}
            </button>
          </div>
          <p className="muted">Imported songs are saved in this browser only, until accounts are added.</p>
        </section>
      )}
    </div>
  )
}
