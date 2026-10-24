import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { renderApp } from '../test/renderApp'

describe('Library', () => {
  it('lists sample songs and filters by title', async () => {
    renderApp('/songs')
    expect(await screen.findByRole('link', { name: 'Ode to Joy (melody)' })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Search songs by title'), 'scale')
    expect(await screen.findByText('1 song')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'C Major Scale' })).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Search songs by title'))
    await userEvent.type(screen.getByLabelText('Search songs by title'), 'no such song')
    expect(await screen.findByText(/No songs match/)).toBeInTheDocument()
  })
})

describe('Song details', () => {
  it('shows the arrangement with custom numbers and note names', async () => {
    renderApp('/songs/sample-first-frets')
    expect(await screen.findByRole('heading', { level: 1, name: 'First Frets on String 1' })).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    expect(within(rows[3]).getByText('13')).toBeInTheDocument()
    expect(within(rows[3]).getByText('G4')).toBeInTheDocument()
  })

  it('handles unknown songs', async () => {
    renderApp('/songs/does-not-exist')
    expect(await screen.findByRole('heading', { name: 'Song not found' })).toBeInTheDocument()
  })
})

describe('Practice navigation', () => {
  const expected = () => screen.getByTestId('expected-number').textContent

  it('shows the first note and moves with previous / next / start over', async () => {
    renderApp('/songs/sample-first-frets/practice') // 10 11 13 11 | 10 13 11 10
    expect(await screen.findByRole('heading', { level: 1, name: 'First Frets on String 1' })).toBeInTheDocument()
    expect(expected()).toBe('10')
    expect(screen.getByTestId('progress')).toHaveTextContent('Note 1 of 8')
    expect(screen.getByRole('button', { name: /^Back/ })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Next$/ }))
    await userEvent.click(screen.getByRole('button', { name: /Next$/ }))
    expect(expected()).toBe('13')
    expect(screen.getByRole('img', { name: 'Play string 1, fret 3.' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Back/ }))
    expect(expected()).toBe('11')

    await userEvent.click(screen.getByRole('button', { name: /Restart/ }))
    expect(expected()).toBe('10')
  })

  it('jumps to any note from the timeline and keeps everything in sync', async () => {
    renderApp('/songs/sample-first-frets/practice')
    const note6 = await screen.findByRole('button', { name: /^Note 6 of 8: 13/ })
    await userEvent.click(note6)
    expect(expected()).toBe('13')
    expect(note6).toHaveAttribute('aria-current', 'step')
    expect(screen.getByTestId('progress')).toHaveTextContent('Note 6 of 8')
    expect(screen.getByTestId('position-status')).toHaveTextContent('Note 6 of 8: 13, string 1, fret 3, G4')
  })

  it('disables Next on the last note', async () => {
    renderApp('/songs/sample-first-frets/practice')
    await userEvent.click(await screen.findByRole('button', { name: /^Note 8 of 8/ }))
    expect(screen.getByRole('button', { name: /Next$/ })).toBeDisabled()
    expect(screen.getByTestId('position-status')).toHaveTextContent('Last note.')
  })

  it('is operable with the keyboard alone', async () => {
    renderApp('/songs/sample-first-frets/practice')
    const next = await screen.findByRole('button', { name: /Next/ })
    next.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(expected()).toBe('13')
  })

  it('says each note aloud when Voice is on, and stops in play-through mode', async () => {
    const spoken: string[] = []
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      text: string
      constructor(text: string) {
        this.text = text
      }
    })
    vi.stubGlobal('speechSynthesis', { speak: (u: { text: string }) => spoken.push(u.text), cancel: vi.fn(), getVoices: () => [] })
    try {
      renderApp('/songs/sample-first-frets/practice') // 10 11 13 ...
      const voice = await screen.findByRole('button', { name: 'Voice' })
      expect(voice).toHaveAttribute('aria-pressed', 'false')
      expect(spoken).toEqual([])

      await userEvent.click(voice)
      expect(voice).toHaveAttribute('aria-pressed', 'true')
      expect(spoken).toEqual(['String 1, open.'])

      await userEvent.click(screen.getByRole('button', { name: /Next$/ }))
      expect(spoken.at(-1)).toBe('String 1, fret 1.')

      await userEvent.click(screen.getByLabelText('Play through'))
      expect(screen.getByText('In Play through, the voice only says “Wrong” after a mistake.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Next$/ }))
      expect(spoken.at(-1)).toBe('String 1, fret 1.')
    } finally {
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })
})

describe('Add a song (import)', () => {
  it('checks, previews and saves instructor numbers, then opens practice', async () => {
    const { router } = renderApp('/import')
    await userEvent.type(screen.getByLabelText('Paste the song here'), '10 11 13')
    expect(screen.getByText(/Recognised as:/)).toHaveTextContent("Instructor's numbers")
    await userEvent.type(screen.getByLabelText('Song title'), 'My Song')
    await userEvent.click(screen.getByRole('button', { name: 'Check song' }))

    expect(await screen.findByRole('heading', { name: /“My Song”: 3 notes/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save and practise' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'My Song' })).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/songs\/import-.*\/practice$/)
  })

  it('turns a pasted chord chart into chords with the words', async () => {
    renderApp('/import')
    await userEvent.click(screen.getByRole('button', { name: 'Paste an example chord chart' }))
    expect(screen.getByText(/Recognised as:/)).toHaveTextContent('Chord chart')
    await userEvent.click(screen.getByRole('button', { name: 'Check song' }))
    const heading = await screen.findByRole('heading', { name: /“My first chord song”: 8 chords/ })
    const steps = within(heading.closest('section')!).getAllByRole('listitem')
    expect(steps).toHaveLength(8)
    // Each chord gets the words written under it.
    expect(steps[4]).toHaveTextContent('C[53 42 30 21 10]Strum it slowly,')
    expect(steps[5]).toHaveTextContent('G[63 52 40 30 20 13]one chord at a time')
  })

  it('shows line-specific errors for invalid numbers', async () => {
    renderApp('/import')
    await userEvent.type(screen.getByLabelText('Paste the song here'), '10 75')
    await userEvent.type(screen.getByLabelText('Song title'), 'Bad')
    await userEvent.click(screen.getByRole('button', { name: 'Check song' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Line 1, column 4')
    expect(alert).toHaveTextContent('Strings are numbered 1 to 6')
    expect(screen.queryByRole('button', { name: 'Save and practise' })).not.toBeInTheDocument()
  })

  it('rejects non-text files before reading them', async () => {
    renderApp('/import')
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    await userEvent.upload(screen.getByLabelText(/Or choose a song file/), file, { applyAccept: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('text file')
  })

  it('loads a tab file and recognises it', async () => {
    renderApp('/import')
    const tab = ['e|-----0-|', 'B|---1---|', 'G|-------|', 'D|-------|', 'A|-------|', 'E|-0-----|'].join('\n')
    const file = new File([tab], 'Little_Tab.txt', { type: 'text/plain' })
    await userEvent.upload(screen.getByLabelText(/Or choose a song file/), file)
    expect(await screen.findByDisplayValue('Little Tab')).toBeInTheDocument()
    expect(screen.getByText(/Recognised as:/)).toHaveTextContent('Guitar tab')
    await userEvent.click(screen.getByRole('button', { name: 'Check song' }))
    expect(await screen.findByRole('heading', { name: /3 notes/ })).toBeInTheDocument()
  })

  it('reads a Word song sheet into the box, shows where it came from, and imports it exactly', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
    const xml = `<w:document ${W}><w:body>${p('Little Star')}${p('')}${p('23    23   15')}${p('Twin  kle  twin')}</w:body></w:document>`
    const bytes = zipSync({ 'word/document.xml': strToU8(xml) })
    renderApp('/import')
    await userEvent.upload(screen.getByLabelText(/Or choose a song file/), new File([new Uint8Array(bytes)], 'Little_Star.docx'))

    expect(await screen.findByTestId('source-file')).toHaveTextContent('Read from Little_Star.docx')
    expect(screen.getByLabelText('Paste the song here')).toHaveValue('Little Star\n\n23    23   15\nTwin  kle  twin')
    expect(screen.getByText(/Recognised as:/)).toHaveTextContent('Song sheet')
    expect(screen.getByLabelText('Song title')).toHaveValue('') // the sheet's own title is used
    await userEvent.click(screen.getByRole('button', { name: 'Check song' }))
    expect(await screen.findByRole('heading', { name: '“Little Star”: 3 notes' })).toBeInTheDocument()
    expect(screen.queryByTestId('import-warnings')).not.toBeInTheDocument()
  })

  it('names the line to check when words and numbers do not match', async () => {
    renderApp('/import')
    await userEvent.click(screen.getByLabelText('Paste the song here'))
    await userEvent.paste('Song\n23 23 15\nTwin kle')
    await userEvent.click(screen.getByRole('button', { name: 'Check song' }))
    expect(await screen.findByTestId('import-warnings')).toHaveTextContent('Line 3: “Twin kle”: 3 numbers but 2 words')
  })
})
