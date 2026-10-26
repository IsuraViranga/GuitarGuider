import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// PDF song sheets are read by pdf.js in the browser, so this is tested in a real browser.

test('a PDF song sheet is read into the box exactly and imported with its words', async ({ page }) => {
  await page.goto('/import')
  await page.getByLabel('Or choose a song file').setInputFiles('tests/fixtures/song-sheet.pdf')

  await expect(page.getByTestId('source-file')).toContainText('Read from song-sheet.pdf')
  const lines = (await page.getByLabel('Paste the song here').inputValue()).split('\n').map((line) => line.trim().split(/\s+/).join(' '))
  expect(lines.filter(Boolean)).toEqual([
    'Example School of Music',
    'Little Song',
    '23 23 15 15 17 17 15',
    'Twin kle, twin kle, lit tle star,',
    '13 13 [53 42 30 21 10] 12',
    'How I won der',
  ])
  await expect(page.getByText(/Recognised as:/)).toContainText('Song sheet')

  await page.getByRole('button', { name: 'Check song' }).click()
  await expect(page.getByRole('heading', { name: '“Little Song”: 1 chord and 10 notes' })).toBeVisible()
  await expect(page.getByTestId('import-warnings')).toHaveCount(0)

  await page.getByRole('button', { name: 'Practise without saving' }).click()
  await expect(page.getByTestId('expected-number')).toHaveText('23')
  await expect(page.getByTestId('lyric')).toContainText('Twin')
})

// The client's real sheet (sharedSongs/ is not committed; skipped when it is not there).
const REAL_PDF = '../sharedSongs/Twinkle.pdf'
test('the Riversheen school Twinkle PDF imports with all 42 notes and words', async ({ page }) => {
  test.skip(!existsSync(REAL_PDF), 'sharedSongs/Twinkle.pdf is not here')
  await page.goto('/import')
  await page.getByLabel('Or choose a song file').setInputFiles(REAL_PDF)
  await expect(page.getByTestId('source-file')).toContainText('Read from Twinkle.pdf')
  const numbers = (await page.getByLabel('Paste the song here').inputValue())
    .split('\n')
    .map((line) => line.trim().split(/\s+/).join(' '))
    .filter((line) => /^[\d ]+$/.test(line))
  expect(numbers).toEqual([
    '23 23 15 15 17 17 15',
    '13 13 12 12 10 10 23',
    '15 15 13 13 12 12 10',
    '15 15 13 13 12 12 10',
    '23 23 15 15 17 17 15',
    '13 13 12 12 10 10 23',
  ])
  await page.getByRole('button', { name: 'Check song' }).click()
  await expect(page.getByRole('heading', { name: '“Twinkle, twinkle”: 42 notes' })).toBeVisible()
  await expect(page.getByTestId('import-warnings')).toHaveCount(0)
})
