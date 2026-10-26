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

// The client's Sinhala sheet whose PDF stores some letters in a broken way (not committed).
const SINHALA_PDF = '../sharedSongs/nil-ahas-thale.pdf'
test('a PDF with broken Sinhala letters: notes are exact, and the damaged words are flagged', async ({ page }) => {
  test.skip(!existsSync(SINHALA_PDF), 'sharedSongs/nil-ahas-thale.pdf is not here')
  await page.goto('/import')
  await page.getByLabel('Or choose a song file').setInputFiles(SINHALA_PDF)
  await expect(page.getByTestId('damaged-words')).toContainText('Sinhala words in this file could not be read correctly')
  await expect(page.getByTestId('damaged-words')).toContainText('Word (.docx)')
  await page.getByLabel('Song title').fill('Nil ahas thale')
  await page.getByRole('button', { name: 'Check song' }).click()
  await expect(page.getByRole('heading', { name: '“Nil ahas thale”: 24 notes' })).toBeVisible()
  await expect(page.getByTestId('import-warnings')).toContainText('Some Sinhala words look damaged')
  const numbers = (await page.getByLabel('Paste the song here').inputValue())
    .split('\n')
    .map((line) => line.trim().split(/\s+/).join(' '))
    .filter((line) => /^[\d ]+$/.test(line))
  expect(numbers).toEqual(['22 23 10 22 23 22 20', '22 23 10 12 14', '12 14 15 12 10 22 20', '10 20 22 20 32'])
})
