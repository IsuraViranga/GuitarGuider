import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { apiSong, fakeServer, signedInAs, signedOut, USER } from '../test/fakeServer'
import { renderApp } from '../test/renderApp'

const saved = (extra: object = {}) => ({
  songId: 'g1',
  songTitle: 'Malata Bambareku Se',
  songArtist: 'Melantha',
  songScope: 'global',
  mode: 'strict',
  completed: true,
  rightCount: 3,
  wrongCount: 1,
  bestStreak: 2,
  skippedCount: 0,
  rating: 2,
  totalSteps: 3,
  playedSteps: 3,
  savedAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
  ...extra,
})
const SONG = { 'GET /api/songs/g1': () => [200, apiSong('g1', 'Malata Bambareku Se')] as [number, unknown] }

describe('Save this practice', () => {
  it('guests are invited to sign in to save', async () => {
    fakeServer({ ...signedOut, ...SONG })
    renderApp('/songs/g1/practice')
    expect(await screen.findByText(/to save your practice and see your progress/)).toBeInTheDocument()
  })

  it('is ready once something is played, saves the practice, and says where it went', async () => {
    const calls = fakeServer({
      ...signedInAs(USER),
      ...SONG,
      'GET /api/progress/g1': () => [404, { detail: 'No saved practice for this song yet.' }],
      'PUT /api/progress/g1': () => [200, saved({ completed: false, rating: null, savedAt: new Date().toISOString() })],
    })
    renderApp('/songs/g1/practice')
    const button = await screen.findByRole('button', { name: /Save this practice/ })
    expect(screen.getByTestId('save-practice')).toHaveTextContent('Not saved yet')
    expect(button).toBeDisabled() // nothing played yet
    await userEvent.click(screen.getByRole('button', { name: /Next$/ })) // note 1 skipped
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(await screen.findByText(/Saved to/)).toHaveTextContent('✓ Saved to My progress')
    expect(screen.getByRole('link', { name: 'My progress' })).toHaveAttribute('href', '/progress')
    const body = calls.find((c) => c.key === 'PUT /api/progress/g1')!.body as Record<string, unknown>
    expect(body).toMatchObject({ mode: 'strict', completed: false, wrongCount: 0, bestStreak: 0, skippedCount: 0 })
    expect(body.record).toEqual([
      { wrong: [], result: 'skipped' },
      { wrong: [], result: null },
      { wrong: [], result: null },
    ])
  })

  it('one per song: when one is saved already, it asks before replacing it', async () => {
    const calls = fakeServer({
      ...signedInAs(USER),
      ...SONG,
      'GET /api/progress/g1': () => [200, { ...saved(), record: [] }],
      'PUT /api/progress/g1': () => [200, saved({ savedAt: new Date().toISOString() })],
    })
    renderApp('/songs/g1/practice')
    expect(await screen.findByText(/Last saved 2 days ago/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2 of 3 picks' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Next$/ }))
    await userEvent.click(screen.getByRole('button', { name: /Save this practice/ }))
    expect(screen.getByRole('alertdialog', { name: 'Replace your saved practice?' })).toHaveTextContent('You keep one per song')
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Keep the old one' }))
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /Save this practice/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Replace it' }))
    expect(await screen.findByText(/Saved to/)).toBeInTheDocument()
    expect(calls.filter((c) => c.key === 'PUT /api/progress/g1')).toHaveLength(1)
  })
})

describe('My progress', () => {
  it('lists each saved practice with picks, numbers and actions', async () => {
    fakeServer({
      ...signedInAs(USER),
      'GET /api/progress': () => [200, { progress: [saved(), saved({ songId: 'm1', songTitle: 'Twinkle', songArtist: null, completed: false, rating: null, playedSteps: 21, totalSteps: 42, wrongCount: 0, rightCount: 21 })] }],
    })
    renderApp('/progress')
    const [first, second] = await screen.findAllByTestId('progress-card')
    expect(within(first).getByRole('img', { name: '2 of 3 picks' })).toBeInTheDocument()
    expect(first).toHaveTextContent('Melantha · Finished · saved 2 days ago')
    expect(first).toHaveTextContent('3 right1 wrong note🔥 2 in a rowNote by note')
    expect(within(first).getByRole('link', { name: 'Practise Malata Bambareku Se again' })).toHaveAttribute('href', '/songs/g1/practice')
    expect(second).toHaveTextContent('50%')
    expect(second).toHaveTextContent('Reached note 21 of 42')
    expect(screen.getByRole('list', { name: 'Summary' })).toHaveTextContent('2 songs saved1 finished 2 picks earned')
  })

  it('"What you played" opens the saved notes', async () => {
    fakeServer({
      ...signedInAs(USER),
      ...SONG,
      'GET /api/progress': () => [200, { progress: [saved()] }],
      'GET /api/progress/g1': () => [
        200,
        { ...saved(), record: [{ wrong: [], result: 'correct' }, { wrong: [{ heardMidi: 67 }], result: 'correct' }, { wrong: [], result: 'correct' }] },
      ],
    })
    renderApp('/progress')
    await userEvent.click(await screen.findByRole('button', { name: 'What you played' }))
    expect(await screen.findByRole('img', { name: 'Note 2, 11: wrong 1 time (played G4), then right' })).toBeInTheDocument()
    expect(screen.queryByText('Tap a red note to practise it again.')).not.toBeInTheDocument()
  })

  it('remove asks first', async () => {
    let removed = false
    const calls = fakeServer({
      ...signedInAs(USER),
      'GET /api/progress': () => [200, { progress: removed ? [] : [saved()] }],
      'DELETE /api/progress/g1': () => {
        removed = true
        return [204]
      },
    })
    renderApp('/progress')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove saved practice of Malata Bambareku Se' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('The song itself stays.')
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText(/No saved practice yet/)).toBeInTheDocument()
    expect(calls.some((c) => c.key === 'DELETE /api/progress/g1')).toBe(true)
  })

  it('guests are asked to sign in', async () => {
    fakeServer(signedOut)
    renderApp('/progress')
    expect(await screen.findByText(/Sign in to see your progress/)).toBeInTheDocument()
  })

  it('the account menu links to My progress and My songs', async () => {
    fakeServer({ ...signedInAs(USER), 'GET /api/songs?scope=global': () => [200, { songs: [] }] })
    renderApp('/songs')
    await userEvent.click(await screen.findByRole('button', { name: /Account:/ }))
    expect(screen.getByRole('link', { name: /My progress/ })).toHaveAttribute('href', '/progress')
    expect(screen.getByRole('navigation', { name: 'Your account' })).toHaveTextContent('My songs')
  })
})
