import { expect, test, type Page } from '@playwright/test'

// The fake microphone plays, on a loop: 1.5 s quiet, then a G4 (= 13) ringing for 2.5 s.
// "First Frets on String 1" is 10 11 13 11 | 10 13 11 10 (E4 F4 G4 F4 | E4 G4 F4 E4).
const SONG = '/songs/sample-first-frets/practice'
const LOOP = { timeout: 30_000 }

/** Counts every sound the app makes (each error sound uses two oscillators). */
async function countSounds(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { soundsPlayed: number }
    w.soundsPlayed = 0
    const original = BaseAudioContext.prototype.createOscillator
    BaseAudioContext.prototype.createOscillator = function (...args) {
      w.soundsPlayed++
      return original.apply(this, args)
    }
  })
}
const soundsPlayed = (page: Page) => page.evaluate(() => (window as unknown as { soundsPlayed: number }).soundsPlayed)

const feedback = (page: Page) => page.getByTestId('feedback')
const progress = (page: Page) => page.getByTestId('progress')

async function startListening(page: Page) {
  await page.getByRole('button', { name: /Start listening/ }).click()
  await expect(page.getByRole('button', { name: /Pause listening/ })).toBeVisible()
}

test('a correct note advances exactly once, with no sound', async ({ page }) => {
  await countSounds(page)
  await page.goto(SONG)
  await page.getByRole('button', { name: /^Note 3 of 8: 13/ }).click()
  await startListening(page)

  await expect(feedback(page)).toHaveAttribute('data-kind', 'correct', LOOP)
  await expect(feedback(page)).toContainText('Correct! 13 (G4)')
  await expect(progress(page)).toHaveText('Note 4 of 8')
  // The G4 keeps ringing for ~2 s more: it must not advance again.
  await page.waitForTimeout(1500)
  await expect(progress(page)).toHaveText('Note 4 of 8')
  expect(await soundsPlayed(page)).toBe(0)
})

test('a wrong note stays on the note, shows both notes and plays one short sound', async ({ page }) => {
  await countSounds(page)
  await page.goto(SONG) // note 1 is 10 = E4; the microphone plays G4
  await startListening(page)

  await expect(feedback(page)).toHaveAttribute('data-kind', 'incorrect', LOOP)
  await expect(feedback(page)).toContainText('Expected 10 (E4), heard G4 (392')
  await expect(progress(page)).toHaveText('Note 1 of 8')
  await expect.poll(() => soundsPlayed(page)).toBe(2) // one sound = two tones

  // The wrong note keeps ringing: no more sounds.
  await page.waitForTimeout(1500)
  expect(await soundsPlayed(page)).toBe(2)

  // The next pluck (when the loop repeats) is a new wrong note: exactly one more sound.
  await expect.poll(() => soundsPlayed(page), LOOP).toBe(4)
  await expect(progress(page)).toHaveText('Note 1 of 8')
})

test('the error sound can be switched off', async ({ page }) => {
  await countSounds(page)
  await page.goto(SONG)
  await page.getByLabel('Play a short sound when a wrong note is played').uncheck()
  await startListening(page)
  await expect(feedback(page)).toHaveAttribute('data-kind', 'incorrect', LOOP)
  await page.waitForTimeout(500)
  expect(await soundsPlayed(page)).toBe(0)
})

test('jumping while a note rings: the mic stays on, the ringing note is ignored, the next pluck counts', async ({ page }) => {
  await page.goto(SONG)
  await startListening(page)
  await expect(feedback(page)).toHaveAttribute('data-kind', 'incorrect', LOOP)

  // The G4 is still ringing. Jump to note 6, which IS a G4.
  await page.getByRole('button', { name: /^Note 6 of 8: 13/ }).click()
  await expect(page.getByRole('button', { name: /Pause listening/ })).toBeVisible()
  await expect(feedback(page)).toHaveAttribute('data-kind', 'neutral')
  await page.waitForTimeout(1200)
  await expect(progress(page)).toHaveText('Note 6 of 8') // stale ringing note did not count

  // The next fresh pluck is compared with the new target and advances.
  await expect(progress(page)).toHaveText('Note 7 of 8', LOOP)
  await expect(feedback(page)).toContainText('Correct! 13 (G4)')
})

test('finishing the last note completes the song', async ({ page }) => {
  await page.goto('/import')
  await page.getByLabel('Song notes').fill('title: One Note\n11 13')
  await page.getByRole('button', { name: 'Check song' }).click()
  await page.getByRole('button', { name: 'Save to my songs' }).click()
  await page.getByRole('link', { name: 'Start practice' }).click()

  await page.getByRole('button', { name: /^Note 2 of 2/ }).click()
  await startListening(page)
  await expect(feedback(page)).toHaveAttribute('data-kind', 'complete', LOOP)
  await expect(feedback(page)).toContainText('Song complete')
  await expect(page.getByRole('heading', { name: 'Last note' })).toBeVisible()

  await page.getByRole('button', { name: /Restart/ }).click()
  await expect(progress(page)).toHaveText('Note 1 of 2')
  await expect(feedback(page)).toHaveAttribute('data-kind', 'neutral')
})

test('shows the live note while listening, and pausing releases the microphone', async ({ page }) => {
  await page.goto(SONG)
  await startListening(page)
  await expect(page.getByTestId('live-note')).toHaveText('G4', LOOP)
  await page.getByRole('button', { name: /Pause listening/ }).click()
  await expect(page.getByText('Not listening.')).toBeVisible()
  await expect(page.getByTestId('live-note')).toHaveCount(0)
})

test('saves a 6-second test recording as a WAV file', async ({ page }, testInfo) => {
  await page.goto(SONG)
  await startListening(page)
  await expect(page.getByText('Listening. Play the note.')).toBeVisible(LOOP)
  await page.getByText('Detection details (for testing)').click()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save a 6-second test recording/ }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^guitar-test-\d{8}-\d{6}\.wav$/)
  const path = testInfo.outputPath('recording.wav')
  await file.saveAs(path)
  const { statSync } = await import('node:fs')
  expect(statSync(path).size).toBeGreaterThan(6 * 44100 * 4) // 6 s of 32-bit samples
  await expect(page.getByText(/Saved “guitar-test-.*\.wav”/)).toBeVisible()
})

test('the bottom bar starts listening; the note card shows mic status and the next notes', async ({ page }) => {
  await page.goto(SONG)
  await expect(page.getByTestId('upcoming')).toHaveText('Then: 11 · 13 · 11 · 10')
  await expect(page.getByTestId('mic-line')).toContainText('Microphone off')
  await page.getByRole('group', { name: 'Practice controls' }).getByRole('button', { name: /Listen/ }).click()
  await expect(page.getByTestId('mic-line')).toContainText('hearing G4', LOOP)
  await page.getByRole('group', { name: 'Practice controls' }).getByRole('button', { name: /Pause/ }).click()
  await expect(page.getByTestId('mic-line')).toContainText('Microphone off')
})
