// Builds the sound file Chromium plays as a fake microphone in the listening tests.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { encodeWav } from '../../src/audio/wav'
import { concat, mix, noise, pluck, SAMPLE_RATE } from '../../src/test/synth'

/** 1.5 s of quiet room (for calibration), then a G4 (string 1, fret 3) ringing for 2.5 s. Chromium loops it. */
export function writeFakeMicWav(path: string) {
  const room = 0.0008
  const signal = concat(noise(1.5, room, 1), mix(pluck(392, 2.5, { amplitude: 0.4, seed: 5 }), noise(2.5, room, 2)))
  mkdirSync(dirname(path), { recursive: true })
  // Chromium's fake microphone expects 16-bit PCM.
  writeFileSync(path, Buffer.from(encodeWav(signal, SAMPLE_RATE, 'pcm16')))
}
