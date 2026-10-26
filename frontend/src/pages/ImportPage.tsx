import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import { PageBanner } from '../components/decor/PageBanner'
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
import { extractDocumentText, isDocumentFileName } from '../songs/documentText'
import { useAuth } from '../auth/authContext'
import { DRAFT_SONG_ID, useSongRepository, type NewSong } from '../songs/songRepository'
import { groupKey } from '../songs/lines'
import { songToText } from '../songs/songText'
import { decodeTextFile } from '../songs/text'
import type { Difficulty, Song, SongIssue, SongNote } from '../songs/types'
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

const FORMAT_CARDS: { format: SongFileFormat; name: string; sample: string }[] = [
  { format: 'chord-chart', name: 'Chord chart', sample: 'C        G\nWords of the song' },
  { format: 'ascii-tab', name: 'Guitar tab', sample: 'e|--0--3--|\nB|--1-----|' },
  { format: 'guitar-numbers', name: "Instructor's numbers", sample: '10 11 13\n[53 42 30 21 10]' },
  { format: 'song-sheet', name: 'Song sheet (Word, PDF)', sample: '23   23   15\nTwin kle, twin' },
]

function issueText(issue: SongIssue): string {
  const where = [issue.line && `Line ${issue.line}`, issue.column && `column ${issue.column}`].filter(Boolean)
  return where.length > 0 ? `${where.join(', ')}: ${issue.message}` : issue.message
}

/** What is typed on the page, kept for this browser tab (e.g. while the user signs up to save it). */
const DRAFT_KEY = 'mga:import-draft:v1'
type Draft = { text: string; title: string; artist: string; difficulty: Difficulty | '' }

function readDraft(): Partial<Draft> {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<Draft>
  } catch {
    return {}
  }
}

function writeDraft(draft: Draft | null) {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Not kept: the page still works.
  }
}

/** "Add a song" — or, with `editSong`, the same page for changing an existing song. */
export function ImportPage({ editSong }: { editSong?: Song } = {}) {
  usePageTitle(editSong ? `Edit ${editSong.title}` : 'Add a song')
  const repository = useSongRepository()
  const navigate = useNavigate()
  const auth = useAuth()
  const [params] = useSearchParams()
  const isAdmin = auth.user?.role === 'admin'
  const [initial] = useState<Partial<Draft>>(() =>
    editSong
      ? { text: editSong.sourceText ?? songToText(editSong), title: editSong.title, artist: editSong.artist ?? '', difficulty: editSong.difficulty ?? '' }
      : readDraft(),
  )

  const [text, setText] = useState(initial.text ?? '')
  const [title, setTitle] = useState(initial.title ?? '')
  const [artist, setArtist] = useState(initial.artist ?? '')
  const [difficulty, setDifficulty] = useState<Difficulty | ''>(initial.difficulty ?? '')
  const [saveTo, setSaveTo] = useState<'mine' | 'global'>(params.get('to') === 'global' ? 'global' : 'mine')
  const [formatOverride, setFormatOverride] = useState<SongFileFormat | 'auto'>('auto')
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** The file the text came from, shown to the user and kept with the saved song. */
  const [sourceFile, setSourceFile] = useState<string | null>(null)
  const [readingFile, setReadingFile] = useState(false)

  // Keep a new song's text for this tab, so it survives signing in to save it.
  useEffect(() => {
    if (!editSong) writeDraft(text || title || artist ? { text, title, artist, difficulty } : null)
  }, [editSong, text, title, artist, difficulty])

  const detected = text.trim() ? detectFormat(text) : null
  const format = formatOverride === 'auto' ? detected : formatOverride
  let step = 0
  if (result?.ok) step = 2
  else if (text.trim()) step = 1

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
    if (isDocumentFileName(file.name)) {
      await loadDocument(file)
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
      setSourceFile(file.name)
      if (!title) setTitle(titleFromFileName(file.name))
    } catch {
      setFileError('The file could not be read.')
    }
  }

  /** Word or PDF: the text is put in the paste box, so the user sees exactly what was read. */
  async function loadDocument(file: File) {
    setReadingFile(true)
    try {
      const extracted = await extractDocumentText(file.name, new Uint8Array(await file.arrayBuffer()))
      if (!extracted.ok) {
        setFileError(extracted.message)
        return
      }
      edited(setText)(extracted.text)
      setSourceFile(file.name)
      // The sheet's own title ("Twinkle, twinkle") is better than the file name; use the name only if there is none.
      const probe = importSongText(extracted.text, 'auto')
      if (!title && !probe.ok && probe.issues.some((issue) => issue.message.startsWith('Please give the song a title'))) {
        setTitle(titleFromFileName(file.name))
      }
    } finally {
      setReadingFile(false)
    }
  }

  function handleCheck(event: FormEvent) {
    event.preventDefault()
    setResult(importSongText(text, formatOverride, title))
  }

  /** The checked song with the fields typed on the page and the text it was made from. */
  function songToSave(): NewSong | null {
    if (!result?.ok) return null
    const description = result.song.description ?? (sourceFile ? `From ${sourceFile}` : editSong?.description)
    return {
      ...result.song,
      ...(artist.trim() ? { artist: artist.trim() } : { artist: undefined }),
      ...(difficulty ? { difficulty } : {}),
      ...(description ? { description } : {}),
      sourceText: text,
    }
  }

  async function handleSave() {
    const song = songToSave()
    if (!song) return
    setSaving(true)
    setSaveError(null)
    try {
      if (editSong) {
        await repository.updateSong(editSong.id, song)
        navigate(`/songs/${editSong.id}`)
      } else {
        const saved = await repository.createSong(song, isAdmin ? saveTo : 'mine')
        writeDraft(null)
        navigate(`/songs/${saved.id}/practice`)
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The song could not be saved.')
      setSaving(false)
    }
  }

  /** Guests: practise the checked song without saving it. */
  function practiseWithoutSaving() {
    const song = songToSave()
    if (!song) return
    try {
      repository.practiseWithoutSaving(song)
      navigate(`/songs/${DRAFT_SONG_ID}/practice`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The song could not be kept for practice.')
    }
  }

  const simplified = result?.ok ? [...new Set(result.song.notes.map((n) => n.chord?.simplifiedFrom).filter(Boolean))] : []

  return (
    <div className="page stack">
      <PageBanner
        kicker={editSong ? (editSong.scope === 'global' ? 'Global set list' : 'My songs') : 'Bring your own songs'}
        title={editSong ? 'Edit song' : 'Add a song'}
        headingId="import-heading"
      />
      <p className={styles.intro}>
        Copy a song from any website and paste it below, or choose a song file (Word, PDF or text). The app works out
        which kind it is and turns it into guitar numbers for you.
      </p>

      <ul className={styles.formats} aria-label="Kinds of song you can paste">
        {FORMAT_CARDS.map((card) => {
          const active = format === card.format
          return (
            <li key={card.format} className={`${styles.format} ${active ? styles.formatActive : ''}`}>
              <span className={styles.formatName}>
                {active && <span aria-hidden="true">✓ </span>}
                {card.name}
                {active && <span className="visually-hidden"> (recognised)</span>}
              </span>
              <pre className={styles.formatSample} aria-hidden="true">
                {card.sample}
              </pre>
            </li>
          )
        })}
      </ul>

      <ol className={styles.progress} aria-label="Steps">
        {['Paste', 'Check', 'Practise'].map((label, i) => {
          return (
            <li
              key={label}
              className={`${styles.progressStep} ${i <= step ? styles.progressDone : ''}`}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className={styles.progressDot}>{i + 1}</span>
              {label}
            </li>
          )
        })}
      </ol>

      <form className={`card stack ${styles.studio}`} onSubmit={handleCheck} noValidate>
        <div className="field">
          <label htmlFor="import-text" className={styles.bigLabel}>
            Paste the song here
          </label>
          <textarea
            id="import-text"
            className={`mono ${styles.paste}`}
            rows={10}
            value={text}
            onChange={(event) => {
              if (!event.target.value.trim()) setSourceFile(null)
              edited(setText)(event.target.value)
            }}
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
          {sourceFile && text.trim() && (
            <p className={styles.source} data-testid="source-file">
              <span aria-hidden="true">📄 </span>
              Read from <strong>{sourceFile}</strong>. The box shows exactly what was read: compare it with your sheet, fix
              anything if needed, then press “Check song”.
            </p>
          )}
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
          <label htmlFor="import-file">Or choose a song file</label>
          <input
            id="import-file"
            className={styles.file}
            type="file"
            accept=".docx,.pdf,.txt,.tab,.cho,.chopro,.chordpro,.pro,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFile}
            aria-describedby="import-file-help"
            disabled={readingFile}
          />
          <p id="import-file-help" className="muted">
            Word (.docx), PDF, text (.txt, .tab) or ChordPro. For Sinhala words, the Word file is best: PDFs can mix up
            Sinhala letters.
          </p>
          {readingFile && <p role="status">Reading the file…</p>}
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

        <div className={styles.twoFields}>
          <div className="field">
            <label htmlFor="import-artist">
              Artist <span className="muted">(optional)</span>
            </label>
            <input
              id="import-artist"
              type="text"
              maxLength={120}
              value={artist}
              onChange={(event) => edited(setArtist)(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="import-difficulty">
              Difficulty <span className="muted">(optional)</span>
            </label>
            <select
              id="import-difficulty"
              className={styles.select}
              value={difficulty}
              onChange={(event) => edited(setDifficulty)(event.target.value as Difficulty | '')}
            >
              <option value="">Not set</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
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
          {result.warnings.length > 0 && (
            <div className="notice" data-testid="import-warnings">
              <p>
                <strong>Please check {result.warnings.length === 1 ? 'this line' : 'these lines'}:</strong>
              </p>
              <ul>
                {result.warnings.map((warning, i) => (
                  <li key={i}>{issueText(warning)}</li>
                ))}
              </ul>
            </div>
          )}
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
          {auth.status !== 'signedIn' && !editSong ? (
            <div className={styles.guestSave} data-testid="guest-save">
              <p>
                <strong>Create a free account to save this song.</strong> What you typed stays here while you sign up.
              </p>
              <div className="button-row">
                <Link className="button button-primary" to="/signup" state={{ from: '/import' }}>
                  Create a free account
                </Link>
                <Link className="button" to="/signin" state={{ from: '/import' }}>
                  Sign in
                </Link>
                <button type="button" className="button" onClick={practiseWithoutSaving}>
                  Practise without saving
                </button>
              </div>
            </div>
          ) : (
            <>
              {isAdmin && !editSong && (
                <fieldset className={styles.saveTo}>
                  <legend>Save to</legend>
                  <label>
                    <input type="radio" name="save-to" checked={saveTo === 'mine'} onChange={() => setSaveTo('mine')} /> 🎸 My songs
                  </label>
                  <label>
                    <input type="radio" name="save-to" checked={saveTo === 'global'} onChange={() => setSaveTo('global')} /> 🌍 Global set list (everyone)
                  </label>
                </fieldset>
              )}
              <div className="button-row">
                <button type="button" className="button button-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : editSong ? 'Save changes' : 'Save and practise'}
                </button>
                {editSong && (
                  <Link className="button" to={`/songs/${editSong.id}`}>
                    Cancel
                  </Link>
                )}
              </div>
              <p className="muted">
                {editSong?.scope === 'global' || (isAdmin && saveTo === 'global' && !editSong)
                  ? 'Global songs are seen by everyone.'
                  : 'Saved in your account: open it from My songs on any phone.'}
              </p>
            </>
          )}
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
/** Steps grouped by line (measure), so the preview reads like the sheet: each number with its word under it. */
function previewLines(notes: readonly SongNote[]): SongNote[][] {
  const lines: SongNote[][] = []
  for (const note of notes) {
    const last = lines.at(-1)
    if (last && groupKey(last[0]) === groupKey(note)) last.push(note)
    else lines.push([note])
  }
  return lines
}

/** Every step as it will be practised: chord name or note, its guitar numbers, and the words. */
function SongPreview({ notes }: { notes: readonly SongNote[] }) {
  return (
    <div className={styles.preview}>
      {previewLines(notes).map((line) => (
        <ol
          key={line[0].index}
          className={`${styles.previewLine} ${(line[0].line ?? 0) % 2 === 0 ? styles.previewEven : ''}`}
          start={line[0].index + 1}
          data-line={line[0].line}
          aria-label={line[0].line !== undefined ? `Line ${line[0].line}` : undefined}
        >
          {line.map((note) => {
            const text = describeNote(note)
            return (
              <li key={note.index} className={`${styles.step} ${note.chord ? styles.stepChord : ''}`}>
                <span className={styles.stepName}>{note.chord ? (note.chord.name ?? 'Chord') : text.number}</span>
                <span className={styles.stepNumbers}>{note.chord ? text.number : text.noteName}</span>
                {note.lyric && <span className={styles.stepLyric}>{note.lyric}</span>}
              </li>
            )
          })}
        </ol>
      ))}
    </div>
  )
}
