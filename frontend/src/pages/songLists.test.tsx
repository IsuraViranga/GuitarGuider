import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DEVICE_SONGS_KEY } from '../songs/songRepository'
import { ADMIN, apiSong, fakeServer, signedInAs, signedOut, USER } from '../test/fakeServer'
import { renderApp } from '../test/renderApp'

const GLOBAL = { 'GET /api/songs?scope=global': () => [200, { songs: [apiSong('g1', 'Malata Bambareku Se', { artist: 'Melantha' })] }] as [number, unknown] }

describe('Songs page: Global set list and My songs', () => {
  it('shows the global set list from the server, with where each song lives', async () => {
    fakeServer({ ...signedOut, ...GLOBAL })
    renderApp('/songs')
    const card = (await screen.findByRole('link', { name: 'Malata Bambareku Se' })).closest('li')!
    expect(within(card).getByText('Melantha')).toBeInTheDocument()
    expect(within(card).getByText('Global')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Global set list/ })).toHaveAttribute('aria-current', 'page')
  })

  it('guests opening My songs are invited to create a free account', async () => {
    fakeServer({ ...signedOut, ...GLOBAL })
    renderApp('/songs?list=mine')
    expect(await screen.findByRole('heading', { name: 'Keep your own songs' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create a free account' })).toHaveAttribute('href', '/signup')
    expect(screen.queryByRole('link', { name: 'Malata Bambareku Se' })).not.toBeInTheDocument()
  })

  it('signed in: My songs lists your songs, with Add a song', async () => {
    fakeServer({ ...signedInAs(USER), 'GET /api/songs?scope=mine': () => [200, { songs: [apiSong('m1', 'Twinkle my way', { scope: 'mine', canEdit: true })] }] })
    renderApp('/songs?list=mine')
    const card = (await screen.findByRole('link', { name: 'Twinkle my way' })).closest('li')!
    expect(within(card).getByText('My song')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add a song/ })).toHaveAttribute('href', '/import')
  })

  it('an empty My songs explains how to add one', async () => {
    fakeServer({ ...signedInAs(USER), 'GET /api/songs?scope=mine': () => [200, { songs: [] }] })
    renderApp('/songs?list=mine')
    expect(await screen.findByText('No songs yet. Tap “Add a song” to paste or upload your first one.')).toBeInTheDocument()
  })

  it('searching My songs asks the server', async () => {
    const calls = fakeServer({
      ...signedInAs(USER),
      'GET /api/songs?scope=mine': () => [200, { songs: [] }],
      'GET /api/songs?scope=mine&q=twin': () => [200, { songs: [apiSong('m1', 'Twinkle my way', { scope: 'mine' })] }],
    })
    renderApp('/songs?list=mine')
    await userEvent.type(await screen.findByLabelText('Search songs by title or artist'), 'twin')
    expect(await screen.findByRole('link', { name: 'Twinkle my way' })).toBeInTheDocument()
    expect(calls.filter((c) => c.key.startsWith('GET /api/songs?scope=mine&q=')).map((c) => c.key)).toEqual(['GET /api/songs?scope=mine&q=twin'])
  })

  it('songs saved only on this phone can be moved into the account', async () => {
    localStorage.setItem(
      DEVICE_SONGS_KEY,
      JSON.stringify([{ id: 'import-1', title: 'Old phone song', tuningId: 'standard', source: 'import', notes: apiSong('x', 'x').notes }]),
    )
    let moved = false
    const calls = fakeServer({
      ...signedInAs(USER),
      'GET /api/songs?scope=mine': () => [200, { songs: moved ? [apiSong('m9', 'Old phone song', { scope: 'mine' })] : [] }],
      'POST /api/songs/move-from-device': () => {
        moved = true
        return [201, { songs: [] }]
      },
    })
    renderApp('/songs?list=mine')
    expect(await screen.findByText('1 song is saved only on this phone.')).toBeInTheDocument()
    expect(await screen.findByText('On this phone')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Move to my account' }))
    expect(await screen.findByText(/Moved 1 song into My songs/)).toBeInTheDocument()
    expect(await screen.findByText('My song')).toBeInTheDocument()
    expect(screen.queryByText('On this phone')).not.toBeInTheDocument()
    expect((calls.find((c) => c.key === 'POST /api/songs/move-from-device')!.body as { songs: { title: string }[] }).songs[0].title).toBe('Old phone song')
  })

  it('only the admin sees "Add a global song"', async () => {
    fakeServer({ ...signedInAs(ADMIN), ...GLOBAL })
    renderApp('/songs')
    expect(await screen.findByRole('link', { name: /Add a global song/ })).toHaveAttribute('href', '/import?to=global')
  })

  it('a normal user does not', async () => {
    fakeServer({ ...signedInAs(USER), ...GLOBAL })
    renderApp('/songs')
    await screen.findByRole('link', { name: 'Malata Bambareku Se' })
    expect(screen.queryByRole('link', { name: /Add a global song/ })).not.toBeInTheDocument()
  })
})

describe('Saving, editing and deleting songs', () => {
  async function checkSong(text = '10 11 13', title = 'My Song') {
    await userEvent.type(await screen.findByLabelText('Paste the song here'), text)
    await userEvent.type(screen.getByLabelText('Song title'), title)
    await userEvent.type(screen.getByLabelText(/^Artist/), 'Melantha')
    await userEvent.selectOptions(screen.getByLabelText(/^Difficulty/), 'beginner')
    await userEvent.click(screen.getByRole('button', { name: 'Check song' }))
  }

  it('signed in: saves to My songs with artist, difficulty and the original text, then opens practice', async () => {
    const calls = fakeServer({
      ...signedInAs(USER),
      'POST /api/songs': (body) => [201, { ...apiSong('new1', 'My Song', { scope: 'mine', canEdit: true }), ...(body as object), id: 'new1', scope: 'mine' }],
      'GET /api/songs/new1': () => [200, apiSong('new1', 'My Song', { scope: 'mine', canEdit: true })],
    })
    const { router } = renderApp('/import')
    await screen.findByRole('button', { name: /Account:/ })
    await checkSong()
    await userEvent.click(await screen.findByRole('button', { name: 'Save and practise' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'My Song' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/songs/new1/practice')
    const saved = calls.find((c) => c.key === 'POST /api/songs')!.body as Record<string, unknown>
    expect(saved).toMatchObject({ title: 'My Song', artist: 'Melantha', difficulty: 'beginner', sourceText: '10 11 13', scope: 'mine', tuningId: 'standard' })
    expect((saved.notes as unknown[]).length).toBe(3)
  })

  it('the admin can save straight to the global set list', async () => {
    const calls = fakeServer({
      ...signedInAs(ADMIN),
      'POST /api/songs': () => [201, apiSong('g9', 'My Song', { canEdit: true })],
      'GET /api/songs/g9': () => [200, apiSong('g9', 'My Song', { canEdit: true })],
    })
    renderApp('/import?to=global')
    await screen.findByRole('button', { name: /Account:/ })
    await checkSong()
    expect(await screen.findByLabelText(/Global set list/)).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Save and practise' }))
    await screen.findByRole('heading', { level: 1, name: 'My Song' })
    expect(calls.find((c) => c.key === 'POST /api/songs')!.body).toMatchObject({ scope: 'global' })
  })

  it('the owner can edit a song: the page opens with its text, and saves the change', async () => {
    let title = 'Old Title'
    const calls = fakeServer({
      ...signedInAs(USER),
      'GET /api/songs/m1': () => [200, apiSong('m1', title, { scope: 'mine', canEdit: true, artist: 'Melantha', sourceText: '10 11 13' })],
      'PUT /api/songs/m1': (body) => {
        title = (body as { title: string }).title
        return [200, { ...apiSong('m1', title, { scope: 'mine', canEdit: true }), ...(body as object) }]
      },
    })
    const { router } = renderApp('/songs/m1/edit')
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit song' })).toBeInTheDocument()
    expect(screen.getByLabelText('Paste the song here')).toHaveValue('10 11 13')
    expect(screen.getByLabelText(/^Artist/)).toHaveValue('Melantha')
    await userEvent.clear(screen.getByLabelText('Song title'))
    await userEvent.type(screen.getByLabelText('Song title'), 'New Title')
    await userEvent.click(screen.getByRole('button', { name: 'Check song' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New Title' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/songs/m1')
    expect(calls.find((c) => c.key === 'PUT /api/songs/m1')!.body).toMatchObject({ title: 'New Title', artist: 'Melantha' })
  })

  it('a song you cannot change opens with a clear message instead of the form', async () => {
    fakeServer({ ...signedInAs(USER), 'GET /api/songs/g1': () => [200, apiSong('g1', 'Malata Bambareku Se')] })
    renderApp('/songs/g1/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the admin can change songs in the global set list.')
    expect(screen.queryByLabelText('Paste the song here')).not.toBeInTheDocument()
  })

  it('deleting asks first, then removes the song and returns to My songs', async () => {
    const calls = fakeServer({
      ...signedInAs(USER),
      'GET /api/songs/m1': () => [200, apiSong('m1', 'Delete Me', { scope: 'mine', canEdit: true })],
      'DELETE /api/songs/m1': () => [204],
      'GET /api/songs?scope=mine': () => [200, { songs: [] }],
    })
    const { router } = renderApp('/songs/m1')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete song' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete “Delete Me”? This cannot be undone.')
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }))
    await screen.findByText(/No songs yet/)
    expect(router.state.location.search).toBe('?list=mine')
    expect(calls.some((c) => c.key === 'DELETE /api/songs/m1')).toBe(true)
  })

  it('songs you cannot change have no Edit or Delete', async () => {
    fakeServer({ ...signedInAs(USER), 'GET /api/songs/g1': () => [200, apiSong('g1', 'Malata Bambareku Se')] })
    renderApp('/songs/g1')
    await screen.findByRole('heading', { level: 1, name: 'Malata Bambareku Se' })
    expect(screen.queryByRole('link', { name: 'Edit song' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete song' })).not.toBeInTheDocument()
  })

  it('what a guest typed is still there when they come back (e.g. after signing up to save it)', async () => {
    fakeServer(signedOut)
    const first = renderApp('/import')
    await userEvent.type(await screen.findByLabelText('Paste the song here'), '10 11')
    await userEvent.type(screen.getByLabelText('Song title'), 'Kept')
    first.unmount()
    renderApp('/import')
    expect(await screen.findByLabelText('Paste the song here')).toHaveValue('10 11')
    expect(screen.getByLabelText('Song title')).toHaveValue('Kept')
  })
})
