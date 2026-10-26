import { expect, test, type Page } from '@playwright/test'

// Full stack: the real API server (backend/ on http://localhost:8000, with the built-in songs
// added by "python -m app.cli seed-songs"). Skipped when that server is not running.
// The admin test also needs: python -m app.cli create-admin --email e2e-admin@example.com --name "E2E Admin"
// with the password "admin-pass-1".

test.beforeAll(async ({ request }) => {
  const up = await request.get('http://localhost:8000/api/health').then((r) => r.ok(), () => false)
  test.skip(!up, 'The API server is not running on localhost:8000 (see backend/README.md).')
})

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/signup')
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Account: ${name}` })).toBeVisible()
}

const unique = (label: string, project: string) => `${label}-${Date.now()}-${project}`

test('the global set list comes from the server, with the built-in songs', async ({ page }) => {
  await page.goto('/songs')
  await expect(page.getByRole('link', { name: 'Twinkle, twinkle', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Twinkle, twinkle', exact: true }).click()
  await expect(page.getByText('Global', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit song' })).toHaveCount(0)
})

test('a student adds a song, finds it in My songs, edits it and deletes it', async ({ page }, info) => {
  const title = `මගේ ගීතය ${unique('t', info.project.name)}`
  await signUp(page, 'Song Student', `${unique('songs', info.project.name)}@example.com`)

  await page.goto('/songs?list=mine')
  await expect(page.getByText(/No songs yet/)).toBeVisible()
  await page.getByRole('link', { name: /Add a song/ }).click()
  await page.getByLabel('Paste the song here').fill('23 23 15\nTwin kle, twin')
  await page.getByLabel('Song title').fill(title)
  await page.getByLabel(/^Artist/).fill('Melantha')
  await page.getByRole('button', { name: 'Check song' }).click()
  await page.getByRole('button', { name: 'Save and practise' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByTestId('lyric')).toContainText('Twin')

  // In My songs, also after a reload, and found by its artist.
  await page.goto('/songs?list=mine')
  await page.reload()
  const card = page.getByRole('listitem').filter({ hasText: title })
  await expect(card.getByText('My song')).toBeVisible()
  await page.getByLabel('Search songs by title or artist').fill('melantha')
  await expect(card).toBeVisible()
  // Not in the global set list.
  await page.goto('/songs')
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0)

  // Edit: the page opens with the song's text.
  await page.goto('/songs?list=mine')
  await page.getByRole('link', { name: title, exact: true }).click()
  await page.getByRole('link', { name: 'Edit song' }).click()
  await expect(page.getByLabel('Paste the song here')).toHaveValue('23 23 15\nTwin kle, twin')
  await page.getByLabel('Song title').fill(`${title} (v2)`)
  await page.getByRole('button', { name: 'Check song' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `${title} (v2)` })).toBeVisible()

  // Delete (asks first).
  await page.getByRole('button', { name: 'Delete song' }).click()
  await page.getByRole('button', { name: 'Yes, delete it' }).click()
  await expect(page).toHaveURL(/\/songs\?list=mine$/)
  await expect(page.getByText(/No songs yet/)).toBeVisible()
})

test('only the admin adds to the global set list; everyone then sees it', async ({ page, browser }, info) => {
  await page.goto('/signin')
  await page.getByLabel('Email').fill('e2e-admin@example.com')
  await page.getByLabel('Password').fill('admin-pass-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const signedIn = await page.getByRole('button', { name: 'Account: E2E Admin' }).waitFor({ timeout: 8000 }).then(() => true, () => false)
  test.skip(!signedIn, 'No e2e admin account in the local database (see the note at the top of this file).')

  const title = unique('Global Song', info.project.name)
  await page.goto('/songs')
  await page.getByRole('link', { name: /Add a global song/ }).click()
  await page.getByLabel('Paste the song here').fill('10 11 13')
  await page.getByLabel('Song title').fill(title)
  await page.getByRole('button', { name: 'Check song' }).click()
  await expect(page.getByLabel(/Global set list/)).toBeChecked()
  await page.getByRole('button', { name: 'Save and practise' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()

  // A guest (another browser) sees it, without Edit.
  const guest = await browser.newPage()
  await guest.goto('/songs')
  await guest.getByRole('link', { name: title, exact: true }).click()
  await expect(guest.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(guest.getByRole('link', { name: 'Edit song' })).toHaveCount(0)
  await guest.close()

  // The admin removes it again.
  await page.goto('/songs')
  await page.getByRole('link', { name: title, exact: true }).click()
  await page.getByRole('button', { name: 'Delete song' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('It will be removed for everyone.')
  await page.getByRole('button', { name: 'Yes, delete it' }).click()
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0)
})

test('a song saved on the phone before accounts moves into the account', async ({ page }, info) => {
  await page.goto('/')
  await page.evaluate(() => {
    const notes = [{ index: 0, midi: 64, position: { stringNumber: 1, fret: 0 } }]
    localStorage.setItem('guitar-practice:imported-songs:v1', JSON.stringify([{ id: 'import-old', title: 'Old Phone Song', tuningId: 'standard', source: 'import', notes }]))
  })
  await signUp(page, 'Phone Owner', `${unique('phone', info.project.name)}@example.com`)
  await page.goto('/songs?list=mine')
  await expect(page.getByText('1 song is saved only on this phone.')).toBeVisible()
  await page.getByRole('button', { name: 'Move to my account' }).click()
  await expect(page.getByText(/Moved 1 song into My songs/)).toBeVisible()
  await page.reload()
  const card = page.getByRole('listitem').filter({ hasText: 'Old Phone Song' })
  await expect(card.getByText('My song')).toBeVisible()
  await expect(page.getByText('saved only on this phone')).toHaveCount(0)
})
