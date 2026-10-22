import { expect, it } from 'vitest'
import { decodeWav, encodeWav } from './wav'

it('round-trips float and 16-bit WAV files', () => {
  const samples = Float32Array.from([0, 0.5, -0.25, 0.0001, -1])
  const float = decodeWav(encodeWav(samples, 48000))
  expect(float.sampleRate).toBe(48000)
  expect([...float.samples]).toEqual([...samples])

  const pcm = decodeWav(encodeWav(samples, 44100, 'pcm16'))
  expect(pcm.sampleRate).toBe(44100)
  pcm.samples.forEach((value, i) => expect(value).toBeCloseTo(samples[i], 3))
})

it('rejects files that are not WAV', () => {
  expect(() => decodeWav(new TextEncoder().encode('hello world, not audio data').buffer)).toThrow('Not a WAV file')
})
