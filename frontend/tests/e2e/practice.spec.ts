import { expect, test, type Page } from '@playwright/test'

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test('student picks a sample song and navigates through it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Browse songs' }).click()
  await page.getByLabel('Search songs by title').fill('first frets')
  await page.getByRole('link', { name: 'Practise First Frets on String 1' }).click()

  const expected = page.getByTestId('expected-number')
  await expect(expected).toHaveText('10')
  await expect(page.getByRole('img', { name: /string 1, open/ })).toBeVisible()

  await page.getByRole('button', { name: /Next$/ }).click()
  await page.getByRole('button', { name: /Next$/ }).click()
  await expect(expected).toHaveText('13')
  await expect(page.getByRole('img', { name: 'Play string 1, fret 3.' })).toBeVisible()

  await page.getByRole('button', { name: /^Note 7 of 8/ }).click()
  await expect(expected).toHaveText('11')
  await expect(page.getByTestId('progress')).toHaveText('Note 7 of 8')

  await page.getByRole('button', { name: /Restart/ }).click()
  await expect(expected).toHaveText('10')
})

test('pages fit a small phone screen without sideways scrolling', async ({ page }) => {
  for (const url of ['/', '/songs', '/songs/sample-up-the-neck', '/songs/sample-ode-to-joy/practice', '/import']) {
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectNoHorizontalScroll(page)
  }
})

test('practice controls stay visible on a phone after jumping', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile layout only')
  await page.goto('/songs/sample-c-major-scale/practice')
  await expect(page.getByRole('button', { name: /Next$/ })).toBeInViewport()
  await page.getByRole('button', { name: /^Note 12 of 16/ }).click()
  await expect(page.getByRole('button', { name: /Next$/ })).toBeInViewport()
  await page.getByRole('button', { name: /Start listening/ }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: /Next$/ })).toBeInViewport()
})

test('keyboard users can reach and use the controls', async ({ page }) => {
  await page.goto('/songs/sample-open-strings/practice')
  await expect(page.getByTestId('expected-number')).toHaveText('60')
  // Tab from the top of the page until the Next button has focus.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab')
    if (await page.getByRole('button', { name: /Next$/ }).evaluate((el) => el === document.activeElement)) break
  }
  await expect(page.getByRole('button', { name: /Next$/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('expected-number')).toHaveText('50')
})

test('an imported song can be practised', async ({ page }) => {
  await page.goto('/import')
  await page.getByLabel('Song notes').fill('title: Typed Tune\n21 23 | 10')
  await page.getByRole('button', { name: 'Check song' }).click()
  await page.getByRole('button', { name: 'Save to my songs' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Typed Tune' })).toBeVisible()
  await page.getByRole('link', { name: 'Start practice' }).click()
  await expect(page.getByTestId('expected-number')).toHaveText('21')
})

test('a song with a Sinhala title can be imported, found and practised', async ({ page }) => {
  await page.goto('/import')
  const file = { name: 'sinhala.txt', mimeType: 'text/plain', buffer: Buffer.from('title: මගේ පළමු ගීතය\n10 11 | 13', 'utf-8') }
  await page.getByLabel(/Choose a text file/).setInputFiles(file)
  await expect(page.getByLabel('Song title')).toHaveValue('sinhala')
  await page.getByLabel('Song title').fill('')
  await page.getByRole('button', { name: 'Check song' }).click()
  await page.getByRole('button', { name: 'Save to my songs' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'මගේ පළමු ගීතය' })).toBeVisible()

  await page.goto('/songs')
  await page.getByLabel('Search songs by title').fill('පළමු')
  await page.getByRole('link', { name: 'Practise මගේ පළමු ගීතය' }).click()
  await expect(page.getByTestId('expected-number')).toHaveText('10')
})

test('practice mode can be switched and is remembered', async ({ page }) => {
  await page.goto('/songs/sample-ode-to-joy/practice')
  await expect(page.getByRole('radio', { name: 'Note by note' })).toBeChecked()
  await page.getByRole('radio', { name: 'Play through' }).check()
  await expect(page.getByRole('radio', { name: 'Play through' })).toBeChecked()
  await expect(page.getByText('Keeps up when you play the song at speed.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Play through' })).toBeChecked()
})
