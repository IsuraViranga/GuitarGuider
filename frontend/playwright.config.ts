import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { writeFakeMicWav } from './tests/e2e/fakeMicAudio'

const PORT = 5173
const FAKE_MIC_WAV = resolve('tests/fixtures/fake-mic-g4.wav')
writeFakeMicWav(FAKE_MIC_WAV)

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /listening/ },
    // Small Android phone; Chromium is used so only one browser needs installing.
    {
      name: 'mobile',
      use: { ...devices['Galaxy S9+'], viewport: { width: 360, height: 640 } },
      testIgnore: /listening/,
    },
    // Real browser audio pipeline, with a generated guitar sound played as the microphone.
    {
      name: 'fake-mic',
      testMatch: /listening/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
  },
})
