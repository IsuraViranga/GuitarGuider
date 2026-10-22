import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { STANDARD_TUNING } from '../music/tuning'
import { notesFromPositions } from '../songs/validation'
import { Fretboard } from './fretboard/Fretboard'
import { firstVisibleFret } from './fretboard/fretWindow'
import { NoteTimeline } from './timeline/NoteTimeline'

describe('Fretboard', () => {
  it('describes a fretted position in text, not just colour', () => {
    render(<Fretboard position={{ stringNumber: 1, fret: 3 }} tuning={STANDARD_TUNING} />)
    expect(screen.getByRole('img', { name: 'Play string 1, fret 3.' })).toBeInTheDocument()
    const marker = screen.getByTestId('fretboard-marker')
    expect(marker).toHaveAttribute('data-kind', 'fretted')
    expect(marker).toHaveTextContent('3')
  })

  it('shows open strings with a distinct marker', () => {
    render(<Fretboard position={{ stringNumber: 6, fret: 0 }} tuning={STANDARD_TUNING} />)
    expect(screen.getByRole('img', { name: /string 6, open \(no finger/ })).toBeInTheDocument()
    expect(screen.getByTestId('fretboard-marker')).toHaveAttribute('data-kind', 'open')
  })

  it('labels all six strings', () => {
    const { container } = render(<Fretboard position={{ stringNumber: 2, fret: 1 }} tuning={STANDARD_TUNING} />)
    const labels = [...container.querySelectorAll('text')].map((t) => t.textContent)
    for (const n of ['1', '2', '3', '4', '5', '6']) expect(labels).toContain(n)
  })

  it('moves the visible fret window for high frets', () => {
    render(<Fretboard position={{ stringNumber: 1, fret: 12 }} tuning={STANDARD_TUNING} />)
    expect(screen.getByText(/Showing frets 9–15/)).toBeInTheDocument()
    expect(screen.getByTestId('fretboard-marker')).toHaveTextContent('12')
    expect(firstVisibleFret(0, 24)).toBe(1)
    expect(firstVisibleFret(6, 24)).toBe(1)
    expect(firstVisibleFret(24, 24)).toBe(18)
  })
})

describe('NoteTimeline', () => {
  const notes = notesFromPositions(
    [{ position: { stringNumber: 1, fret: 0 } }, { position: { stringNumber: 1, fret: 3 } }, { position: { stringNumber: 6, fret: 0 } }],
    STANDARD_TUNING,
  )

  it('gives each note an accessible name and marks the current one', () => {
    render(<NoteTimeline notes={notes} currentIndex={1} onSelect={() => {}} />)
    const current = screen.getByRole('button', { name: 'Note 2 of 3: 13, string 1, fret 3, G4' })
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: /Note 1 of 3: 10/ })).not.toHaveAttribute('aria-current')
  })

  it('calls onSelect with the chosen note', async () => {
    const onSelect = vi.fn()
    render(<NoteTimeline notes={notes} currentIndex={0} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /Note 3 of 3/ }))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('renders no buttons when read-only', () => {
    render(<NoteTimeline notes={notes} currentIndex={-1} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})
