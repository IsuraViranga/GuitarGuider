import { expect, test } from '@playwright/test'
import { saveGuitarSetup } from './guitarSetup'

// Full stack: needs the API server on http://localhost:8000. Skipped otherwise.

test.beforeAll(async ({ request }) => {
  const up = await request.get('http://localhost:8000/api/health').then((r) => r.ok(), () => false)
  test.skip(!up, 'The API server is not running on localhost:8000 (see backend/README.md).')
})

test('a new account does the guitar setup before the first song; then it is saved with the account', async ({ page }, info) => {
  await page.goto('/signup')
  await page.getByLabel('Your name').fill('Setup Student')
  await page.getByLabel('Email').fill(`setup-${Date.now()}-${info.project.name}@example.com`)
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: 'Account: Setup Student' })).toBeVisible()

  await page.goto('/songs/sample-first-frets/practice')
  await expect(page.getByRole('heading', { name: 'Quick guitar setup' })).toBeVisible()
  await page.getByRole('link', { name: /Start setup/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Guitar setup' })).toBeVisible()

  await saveGuitarSetup(page) // as the setup page does when it finishes
  await page.goto('/songs/sample-first-frets/practice')
  await expect(page.getByTestId('expected-number')).toHaveText('10')
  await expect(page.getByTestId('same-pitch')).toContainText('The string check listens for the string')
})

test('save a practice → see it in My progress → save again replaces it → remove', async ({ page }, info) => {
  const title = `Progress Song ${Date.now()}-${info.project.name}`
  await page.goto('/signup')
  await page.getByLabel('Your name').fill('Progress Student')
  await page.getByLabel('Email').fill(`progress-${Date.now()}-${info.project.name}@example.com`)
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: 'Account: Progress Student' })).toBeVisible()
  await saveGuitarSetup(page)

  await page.goto('/import')
  await page.getByLabel('Paste the song here').fill('10 11 12')
  await page.getByLabel('Song title').fill(title)
  await page.getByRole('button', { name: 'Check song' }).click()
  await page.getByRole('button', { name: 'Save and practise' }).click()

  // Nothing played yet: the save button waits. Skip one note, then save.
  const save = page.getByRole('button', { name: /Save this practice/ })
  await expect(save).toBeDisabled()
  await page.getByRole('button', { name: /Next$/ }).click()
  await save.click()
  await expect(page.getByTestId('save-practice')).toContainText('Saved to My progress')

  await page.goto('/progress')
  const card = page.getByTestId('progress-card').filter({ hasText: title })
  await expect(card).toContainText('Reached note 1 of 3')

  // One save per song: saving again asks, then replaces.
  await card.getByRole('link', { name: `Practise ${title} again` }).click()
  await expect(page.getByTestId('save-practice')).toContainText('Last saved')
  await page.getByRole('button', { name: /Next$/ }).click()
  await page.getByRole('button', { name: /Next$/ }).click()
  await page.getByRole('button', { name: /Save this practice/ }).click()
  await page.getByRole('button', { name: 'Replace it' }).click()
  await expect(page.getByTestId('save-practice')).toContainText('Saved to My progress')

  await page.goto('/progress')
  await expect(page.getByTestId('progress-card')).toHaveCount(1)
  await expect(card).toContainText('Reached note 2 of 3')

  await card.getByRole('button', { name: `Remove saved practice of ${title}` }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByText(/No saved practice yet/)).toBeVisible()
})
