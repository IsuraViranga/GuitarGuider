import { expect, test } from '@playwright/test'

// Dataset collector, full stack: the real browser records the fake microphone (a G4 = 13 on a
// loop), the API checks the WAV and keeps it in local storage (DATASET_STORAGE=local in
// backend/.env). Needs the API server on localhost:8000 and the e2e admin account; skipped otherwise.

const GUITAR = 'E2E guitar'

test('admin records one pluck, listens, saves it, then plays and deletes it', async ({ page }) => {
  const up = await page.request.get('http://localhost:8000/api/health').then((r) => r.ok(), () => false)
  test.skip(!up, 'The API server is not running on localhost:8000.')
  await page.goto('/signin')
  await page.getByLabel('Email').fill('e2e-admin@example.com')
  await page.getByLabel('Password').fill('admin-pass-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const ok = await page.getByRole('button', { name: 'Account: E2E Admin' }).waitFor({ timeout: 8000 }).then(() => true, () => false)
  test.skip(!ok, 'No e2e admin account in the local database.')

  // One test guitar, reused by every run (201 the first time, 409 afterwards).
  const added = await page.request.post('/api/dataset/guitars', { headers: { 'X-Requested-With': 'fetch' }, data: { name: GUITAR } })
  expect([201, 409]).toContain(added.status())

  await page.goto('/record-guitar')
  const guitarId = await page.locator('#dataset-guitar option', { hasText: GUITAR }).first().getAttribute('value')
  await page.getByLabel('Guitar', { exact: true }).selectOption(guitarId!)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /^13: string 1, fret 3/ }).click()
  await expect(page.getByTestId('dataset-position')).toHaveText('13')

  await page.getByRole('button', { name: /Turn on the microphone/ }).click()
  await page.getByRole('button', { name: '● Record 13' }).click()
  // Stops by itself a few seconds after the pluck, then plays it back.
  await expect(page.getByRole('heading', { name: 'Listen to 13' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('dataset-review-audio')).toHaveAttribute('src', /^blob:/)
  await page.getByRole('button', { name: /Save/ }).click()
  await expect(page.getByTestId('dataset-saved')).toContainText(/Saved ✓ \d+ of 5 at 13\./)

  // In the list: the real file is a WAV the server read, kept privately.
  await page.getByRole('button', { name: /Samples/ }).click()
  const newest = page.getByTestId('dataset-sample').first()
  await expect(newest).toContainText('13')
  await expect(newest).toContainText('G4 · 392.00 Hz')
  await newest.getByRole('button', { name: /Play/ }).click()
  const src = await newest.locator('audio').getAttribute('src')
  const file = await page.request.get(src!)
  expect(file.ok()).toBe(true)
  expect((await file.body()).subarray(0, 4).toString()).toBe('RIFF')

  await newest.getByRole('button', { name: /Delete/ }).click()
  await newest.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  expect((await page.request.get(src!)).status()).toBe(404)
})

test('a player records their own guitar: each pluck counts at once, with its fingerprint (no waiting)', async ({ page }, info) => {
  const up = await page.request.get('http://localhost:8000/api/health').then((r) => r.ok(), () => false)
  test.skip(!up, 'The API server is not running on localhost:8000.')
  await page.goto('/signup')
  await page.getByLabel('Your name').fill('Guitar Player')
  await page.getByLabel('Email').fill(`player-${Date.now()}-${info.project.name}@example.com`)
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: 'Account: Guitar Player' })).toBeVisible()

  await page.getByRole('button', { name: 'Account: Guitar Player' }).click()
  await page.getByRole('link', { name: /Record my guitar/ }).click()
  await expect(page.getByRole('heading', { name: 'Record my guitar' })).toBeVisible()
  await page.getByLabel('Guitar name').fill('My guitar')
  await page.getByRole('button', { name: 'Add guitar' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /^13: string 1, fret 3/ }).click()
  await page.getByRole('button', { name: /Turn on the microphone/ }).click()
  await page.getByRole('button', { name: '● Record 13' }).click()
  await expect(page.getByRole('heading', { name: 'Listen to 13' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /Save/ }).click()
  await expect(page.getByTestId('dataset-saved')).toContainText('Saved ✓ 1 of 3 at 13.')

  // The fingerprint was made in the browser and saved with the pluck: nothing to prepare.
  const guitars = await (await page.request.get('/api/dataset/guitars')).json()
  const mine = guitars.find((g: { mine: boolean }) => g.mine)
  expect(mine.fingerprints).toBe(1)
  expect(mine.missingFingerprints).toBe(0)
  const rows = (await (await page.request.get(`/api/dataset/guitars/${mine.id}/fingerprints`)).json()).fingerprints
  expect(rows).toHaveLength(1)
  expect(rows[0].v).toHaveLength(19)
  // Tidy up: the recording is deleted (its audio too).
  const list = await (await page.request.get('/api/dataset/samples')).json()
  expect((await page.request.delete(`/api/dataset/samples/${list.items[0].id}`, { headers: { 'X-Requested-With': 'fetch' } })).status()).toBe(204)
})
