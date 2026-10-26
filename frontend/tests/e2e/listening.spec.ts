import { expect, test, type Page } from '@playwright/test'

// The fake microphone plays, on a loop: 1.5 s quiet, then a G4 (= 13) ringing for 2.5 s.
// "First Frets on String 1" is 10 11 13 11 | 10 13 11 10 (E4 F4 G4 F4 | E4 G4 F4 E4).
// These tests analyse live audio and check timing; running them one at a time keeps them from
// competing for CPU (which made timing checks flaky when run in parallel).
test.describe.configure({ mode: 'serial' })

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
  await expect(feedback(page)).toContainText('Correct note! 13 (G4)')
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

test('with Voice on, a wrong note is followed by a spoken correction', async ({ page }) => {
  // Record what the app says instead of speaking.
  await page.addInitScript(() => {
    const w = window as unknown as { spoken: string[] }
    w.spoken = []
    window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => void w.spoken.push(utterance.text)
  })
  const spoken = () => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)
  await page.goto(SONG) // note 1 is 10 = string 1 open; the microphone plays G4
  await page.getByRole('button', { name: 'Voice' }).click()
  await expect.poll(spoken).toEqual(['String 1, open.'])
  await startListening(page)
  await expect(feedback(page)).toHaveAttribute('data-kind', 'incorrect', LOOP)
  await expect.poll(spoken).toEqual(['String 1, open.', 'Wrong note. Play string 1, open.'])
})

test('in Play through with Voice on, a mistake is followed by a quick "Wrong" only', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { spoken: { text: string; rate: number }[] }
    w.spoken = []
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void w.spoken.push({ text: u.text, rate: u.rate })
  })
  const spoken = () => page.evaluate(() => (window as unknown as { spoken: { text: string; rate: number }[] }).spoken)
  await page.goto(SONG)
  await page.getByLabel('Play through').check()
  await page.getByRole('button', { name: 'Voice' }).click()
  await expect(page.getByText('In Play through, the voice only says “Wrong” after a mistake.')).toBeVisible()
  await startListening(page)
  await expect(feedback(page)).toHaveAttribute('data-kind', 'incorrect', LOOP)
  // No note announcements and no full correction: only fast "Wrong" (the loop repeats the wrong note).
  await expect.poll(async () => (await spoken()).length).toBeGreaterThan(0)
  for (const { text, rate } of await spoken()) {
    expect(text).toBe('Wrong')
    expect(rate).toBeCloseTo(1.6)
  }
})

test('"What you played" shows a wrong note in red with what was heard, and a right note in green', async ({ page }) => {
  await page.goto(SONG) // note 1 is 10 (E4); the microphone plays G4
  await expect(page.getByText(/Your notes appear here as you play/)).toBeVisible()
  await startListening(page)
  await expect(feedback(page)).toHaveAttribute('data-kind', 'incorrect', LOOP)
  const wrong = page.getByRole('button', { name: /^Note 1, 10: wrong 1 time \(played G4\), not played right yet$/ })
  await expect(wrong).toHaveAttribute('data-status', 'mistake')
  await expect(wrong).toContainText('you: G4')

  // Note 3 is 13 = G4: played right first time.
  await page.getByRole('button', { name: /^Note 3 of 8: 13/ }).click()
  await expect(feedback(page)).toHaveAttribute('data-kind', 'correct', LOOP)
  await expect(page.getByRole('button', { name: 'Note 3, 13: right first time' })).toHaveAttribute('data-status', 'right')
  await expect(page.getByTestId('played-summary')).toContainText('✓ 1 right')
  await expect(page.getByTestId('played-summary')).toContainText('✗ 1 to practise')
  // The All notes timeline keeps the same marks.
  await expect(page.getByRole('button', { name: /^Note 1 of 8: 10.*, had a mistake$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Note 3 of 8: 13.*, right first time$/ })).toBeVisible()
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
  await expect(feedback(page)).toContainText('Correct note! 13 (G4)')
})

test('finishing the last note completes the song', async ({ page }) => {
  await page.goto('/import')
  await page.getByLabel('Paste the song here').fill('title: One Note\n11 13')
  await page.getByRole('button', { name: 'Check song' }).click()
  await page.getByRole('button', { name: 'Practise without saving' }).click()

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

test('records a practice run and saves sound + decision log on the computer', async ({ page }) => {
  const { existsSync, readFileSync, rmSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { decodeWav } = await import('../../src/audio/wav')

  await page.goto(SONG)
  await startListening(page)
  await expect(page.getByText('Listening. Play the note.')).toBeVisible(LOOP)
  await page.getByRole('button', { name: /Record this practice/ }).click()
  await expect(page.getByText(/Recording 0:0\d of 2:00/)).toBeVisible()
  await page.waitForTimeout(4500) // long enough to hear one G4 pluck
  await page.getByRole('button', { name: /Stop and save/ }).click()

  const saved = page.getByText(/Saved on your computer: recordings\/practice-\d{8}-\d{6}\.wav and recordings\/practice-\d{8}-\d{6}\.json/)
  await expect(saved).toBeVisible()
  const names = (await saved.textContent())!.match(/practice-\d{8}-\d{6}\.(wav|json)/g)!
  const paths = names.map((name) => resolve('..', 'recordings', name))
  try {
    for (const path of paths) expect(existsSync(path)).toBe(true)
    const wavBytes = readFileSync(paths[0])
    const { samples, sampleRate } = decodeWav(wavBytes.buffer.slice(wavBytes.byteOffset, wavBytes.byteOffset + wavBytes.byteLength))
    expect(samples.length / sampleRate).toBeGreaterThan(4)
    const log = JSON.parse(readFileSync(paths[1], 'utf8'))
    expect(log.frames.length).toBeGreaterThan(100)
    expect(log.frames.some((f: { onset: boolean }) => f.onset)).toBe(true)
    expect(log.events.some((e: { kind: string }) => e.kind === 'noteStart')).toBe(true)
    expect(log.events.some((e: { kind: string; feedback?: string }) => e.kind === 'practice' && e.feedback === 'incorrect')).toBe(true)
  } finally {
    for (const path of paths) rmSync(path, { force: true })
  }
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

test('follows a recording of the whole song, played into the app as a test file', async ({ page }) => {
  const { encodeWav } = await import('../../src/audio/wav')
  const { perform, SAMPLE_RATE } = await import('../../src/test/synth')
  // First Frets on String 1: 10 11 13 11 | 10 13 11 10, one note every 0.5 s.
  const notes = [64, 65, 67, 65, 64, 67, 65, 64].map((midi, i) => ({ midi, stringNumber: 1, start: 0.5 + i * 0.5 }))
  const wav = Buffer.from(encodeWav(perform(notes, 5.5), SAMPLE_RATE, 'pcm16'))

  await page.goto(SONG)
  await page.getByLabel('Test with a recording').setInputFiles({ name: 'first-frets.wav', mimeType: 'audio/wav', buffer: wav })
  await expect(page.getByRole('button', { name: /Pause listening/ })).toBeVisible()
  await expect(feedback(page)).toHaveAttribute('data-kind', 'complete', LOOP)
  await expect(feedback(page)).toContainText('No wrong notes')
})

test('a pasted chord chart becomes a chord song that can be practised', async ({ page }) => {
  const { encodeWav } = await import('../../src/audio/wav')
  const { perform, SAMPLE_RATE } = await import('../../src/test/synth')

  await page.goto('/import')
  await page.getByLabel('Paste the song here').fill('title: Chord test\nC        G\nfirst words\nAm       F\nsecond words')
  await expect(page.getByText(/Recognised as:/)).toContainText('Chord chart')
  await page.getByRole('button', { name: 'Check song' }).click()
  await expect(page.getByRole('heading', { name: /“Chord test”: 4 chords/ })).toBeVisible()
  await page.getByRole('button', { name: 'Practise without saving' }).click()

  // The practice screen shows the chord, its numbers, the words and which strings to skip.
  await expect(page.getByTestId('expected-number')).toHaveText('C')
  await expect(page.getByTestId('expected-chord-numbers')).toHaveText('[53 42 30 21 10]')
  await expect(page.getByTestId('lyric')).toHaveText('♪ first')
  await expect(page.getByRole('img', { name: /Strum C: .* Do not play string 6\./ })).toBeVisible()
  await expect(page.getByTestId('upcoming')).toHaveText('Then: G words · Am second · F words')

  // A recording of the four chords strummed (strings 15 ms apart), one chord per second.
  const chords = [
    [[48, 5], [52, 4], [55, 3], [60, 2], [64, 1]], // C
    [[43, 6], [47, 5], [50, 4], [55, 3], [59, 2], [67, 1]], // G
    [[45, 5], [52, 4], [57, 3], [60, 2], [64, 1]], // Am
    [[41, 6], [48, 5], [53, 4], [57, 3], [60, 2], [65, 1]], // F
  ]
  const notes = chords.flatMap((chord, c) => chord.map(([midi, stringNumber], k) => ({ midi, stringNumber, start: 0.6 + c + k * 0.015 })))
  const wav = Buffer.from(encodeWav(perform(notes, 5.5), SAMPLE_RATE, 'pcm16'))
  await page.getByLabel('Test with a recording').setInputFiles({ name: 'chords.wav', mimeType: 'audio/wav', buffer: wav })
  await expect(feedback(page)).toHaveAttribute('data-kind', 'complete', LOOP)
})
