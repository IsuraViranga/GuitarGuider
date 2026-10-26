import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ADMIN, apiSong, fakeServer, signedInAs, USER } from '../test/fakeServer'
import { renderApp } from '../test/renderApp'
import { timeAgo } from './ShareRequests'

const request = (extra: object = {}) => ({
  id: 'r1',
  songId: 'm1',
  title: 'Malata Bambareku Se',
  artist: 'Melantha',
  requesterName: 'Rasika',
  status: 'pending',
  reason: null,
  noteCount: 3,
  chordCount: 0,
  createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  reviewedAt: null,
  globalSongId: null,
  ...extra,
})
const detail = () => ({ ...request(), song: apiSong('x', 'Malata Bambareku Se', { artist: 'Melantha' }) })

describe('a user shares their song', () => {
  it('Share asks first, sends it, and the card then says it is waiting (with Withdraw)', async () => {
    let shared = false
    const calls = fakeServer({
      ...signedInAs(USER),
      'GET /api/songs?scope=mine': () => [200, { songs: [apiSong('m1', 'Mine', { scope: 'mine', canEdit: true, ...(shared ? { shareStatus: 'pending' } : {}) })] }],
      'POST /api/songs/m1/share': () => {
        shared = true
        return [201, apiSong('m1', 'Mine', { scope: 'mine', canEdit: true, shareStatus: 'pending' })]
      },
    })
    renderApp('/songs?list=mine')
    await userEvent.click(await screen.findByRole('button', { name: 'Share Mine with everyone' }))
    expect(screen.getByRole('alertdialog', { name: 'Share Mine?' })).toHaveTextContent('The admin checks it first. Your own copy stays yours.')
    await userEvent.click(screen.getByRole('button', { name: 'Send to admin' }))
    expect(await screen.findByTestId('share-status')).toHaveTextContent('Waiting for the admin’s review')
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share Mine with everyone' })).not.toBeInTheDocument()
    expect(calls.some((c) => c.key === 'POST /api/songs/m1/share')).toBe(true)
  })

  it('a waiting request can be withdrawn', async () => {
    let waiting = true
    fakeServer({
      ...signedInAs(USER),
      'GET /api/songs?scope=mine': () => [200, { songs: [apiSong('m1', 'Mine', { scope: 'mine', canEdit: true, ...(waiting ? { shareStatus: 'pending' } : {}) })] }],
      'DELETE /api/songs/m1/share': () => {
        waiting = false
        return [204]
      },
    })
    renderApp('/songs?list=mine')
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByRole('button', { name: 'Share Mine with everyone' })).toBeInTheDocument()
    expect(screen.queryByTestId('share-status')).not.toBeInTheDocument()
  })

  it('shows "Shared with everyone", or "Not accepted" with the admin\'s reason', async () => {
    fakeServer({
      ...signedInAs(USER),
      'GET /api/songs?scope=mine': () => [
        200,
        {
          songs: [
            apiSong('a', 'Shared One', { scope: 'mine', canEdit: true, shareStatus: 'approved' }),
            apiSong('b', 'Refused One', { scope: 'mine', canEdit: true, shareStatus: 'rejected', shareReason: 'Please add the words.' }),
          ],
        },
      ],
    })
    renderApp('/songs?list=mine')
    const shared = (await screen.findByRole('link', { name: 'Shared One' })).closest('li')!
    expect(within(shared).getByTestId('share-status')).toHaveTextContent('Shared with everyone')
    // Already shared: no Share button (sharing again would make a second global copy).
    expect(within(shared).queryByRole('button', { name: /Share .* with everyone/ })).not.toBeInTheDocument()
    const refused = screen.getByRole('link', { name: 'Refused One' }).closest('li')!
    expect(within(refused).getByTestId('share-status')).toHaveTextContent('Not accepted for the global set list. Admin: “Please add the words.” You can change it and share again.')
    expect(within(refused).getByRole('button', { name: 'Share Refused One with everyone' })).toBeInTheDocument()
  })

  it('global songs and other people\'s songs have no Share button', async () => {
    fakeServer({ ...signedInAs(USER), 'GET /api/songs?scope=global': () => [200, { songs: [apiSong('g1', 'Twinkle')] }] })
    renderApp('/songs')
    await screen.findByRole('link', { name: 'Twinkle' })
    expect(screen.queryByRole('button', { name: /Share .* with everyone/ })).not.toBeInTheDocument()
  })

  it('the song page also has Share with everyone', async () => {
    const calls = fakeServer({
      ...signedInAs(USER),
      'GET /api/songs/m1': () => [200, apiSong('m1', 'Mine', { scope: 'mine', canEdit: true })],
      'POST /api/songs/m1/share': () => [201, apiSong('m1', 'Mine', { scope: 'mine', canEdit: true, shareStatus: 'pending' })],
    })
    renderApp('/songs/m1')
    await userEvent.click(await screen.findByRole('button', { name: /Share with everyone/ }))
    expect(await screen.findByTestId('share-status')).toHaveTextContent('Waiting for the admin’s review.')
    expect(calls.some((c) => c.key === 'POST /api/songs/m1/share')).toBe(true)
  })
})

describe('the admin reviews requests', () => {
  const adminServer = (extra = {}) =>
    fakeServer({
      ...signedInAs(ADMIN),
      'GET /api/songs?scope=global': () => [200, { songs: [] }],
      'GET /api/share-requests?state=pending': () => [200, { requests: [request()] }],
      'GET /api/share-requests?state=reviewed': () => [200, { requests: [] }],
      'GET /api/share-requests/r1': () => [200, detail()],
      ...extra,
    })

  it('the Requests tab shows how many are waiting and lists them', async () => {
    adminServer()
    renderApp('/songs')
    const tab = await screen.findByRole('link', { name: /Requests, 1 waiting/ })
    await userEvent.click(tab)
    const card = (await screen.findByTestId('pending-requests')).querySelector('li')!
    expect(card).toHaveTextContent('Malata Bambareku Se')
    expect(card).toHaveTextContent('From Rasika · 2 hours ago')
    expect(within(card).getByRole('link', { name: 'Review Malata Bambareku Se' })).toHaveAttribute('href', '/requests/r1')
  })

  it('normal users have no Requests tab, even with the address', async () => {
    fakeServer({ ...signedInAs(USER), 'GET /api/songs?scope=global': () => [200, { songs: [apiSong('g1', 'Twinkle')] }] })
    renderApp('/songs?list=requests')
    await screen.findByRole('link', { name: 'Twinkle' })
    expect(screen.queryByRole('link', { name: /Requests/ })).not.toBeInTheDocument()
  })

  it('approve: the song goes global, with a celebration and a link to it', async () => {
    const calls = adminServer({ 'POST /api/share-requests/r1/approve': () => [200, request({ status: 'approved', globalSongId: 'g9' })] })
    renderApp('/requests/r1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Malata Bambareku Se' })).toBeInTheDocument()
    expect(screen.getByText(/From/)).toHaveTextContent('Melantha · From Rasika · sent 2 hours ago')
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Shared with everyone!' })).toBeInTheDocument()
    expect(screen.getByTestId('celebration')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the song' })).toHaveAttribute('href', '/songs/g9')
    expect(calls.find((c) => c.key === 'POST /api/share-requests/r1/approve')!.body).toBeUndefined()
  })

  it('reject without a reason', async () => {
    const calls = adminServer({ 'POST /api/share-requests/r1/reject': () => [200, request({ status: 'rejected' })] })
    renderApp('/requests/r1')
    await userEvent.click(await screen.findByRole('button', { name: /Reject$/ }))
    expect(screen.getByLabelText(/Reason for Rasika/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reject song' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Not accepted' })).toBeInTheDocument()
    expect(calls.find((c) => c.key === 'POST /api/share-requests/r1/reject')!.body).toEqual({ reason: null })
  })

  it('reject with a reason', async () => {
    const calls = adminServer({ 'POST /api/share-requests/r1/reject': () => [200, request({ status: 'rejected', reason: 'Add the words' })] })
    renderApp('/requests/r1')
    await userEvent.click(await screen.findByRole('button', { name: /Reject$/ }))
    await userEvent.type(screen.getByLabelText(/Reason for Rasika/), 'Add the words')
    await userEvent.click(screen.getByRole('button', { name: 'Reject song' }))
    expect(await screen.findByText(/with your reason/)).toBeInTheDocument()
    expect(calls.find((c) => c.key === 'POST /api/share-requests/r1/reject')!.body).toEqual({ reason: 'Add the words' })
  })

  it('edit and approve: the editor opens with the song as sent and publishes the corrected version', async () => {
    const calls = adminServer({ 'POST /api/share-requests/r1/approve': () => [200, request({ status: 'approved', globalSongId: 'g9' })] })
    const { router } = renderApp('/requests/r1/edit')
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit and approve' })).toBeInTheDocument()
    expect(screen.getByLabelText('Paste the song here')).toHaveValue('10 11 13')
    await userEvent.clear(screen.getByLabelText('Song title'))
    await userEvent.type(screen.getByLabelText('Song title'), 'Malata (fixed)')
    await userEvent.click(screen.getByRole('button', { name: 'Check song' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Approve with these changes' }))
    expect(await screen.findByText(/“Malata \(fixed\)” is now shared with everyone./)).toBeInTheDocument()
    expect(router.state.location.search).toBe('?list=requests')
    expect(calls.find((c) => c.key === 'POST /api/share-requests/r1/approve')!.body).toMatchObject({ title: 'Malata (fixed)', artist: 'Melantha' })
  })

  it('a request that was already reviewed shows no decision buttons', async () => {
    adminServer({ 'GET /api/share-requests/r1': () => [200, { ...detail(), status: 'approved' }] })
    renderApp('/requests/r1')
    expect(await screen.findByText('This request was already approved.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
  })

  it('only the admin can open the review page', async () => {
    fakeServer(signedInAs(USER))
    renderApp('/requests/r1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the admin can review shared songs.')
  })
})

describe('timeAgo', () => {
  it('says how long ago in plain words', () => {
    const now = Date.parse('2026-10-27T12:00:00Z')
    expect(timeAgo('2026-10-27T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-10-27T11:55:00Z', now)).toBe('5 minutes ago')
    expect(timeAgo('2026-10-27T11:00:00Z', now)).toBe('1 hour ago')
    expect(timeAgo('2026-10-25T12:00:00Z', now)).toBe('2 days ago')
  })
})

describe('always the latest from the server', () => {
  it('every request asks for a fresh copy (never an old one from the browser cache)', async () => {
    const calls: RequestInit[] = []
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      calls.push(init ?? {})
      return new Response(JSON.stringify({ songs: [] }), { status: 200 })
    })
    renderApp('/songs')
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2)) // who is signed in + the song list
    expect(calls.every((init) => init.cache === 'no-store')).toBe(true)
    spy.mockRestore()
  })
})
