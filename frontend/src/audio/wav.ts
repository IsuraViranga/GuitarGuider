// Minimal WAV encode/decode for test recordings (mono). 32-bit float keeps very quiet
// microphone signals exact; 16-bit PCM is also read so ordinary recordings can be analysed.

export function encodeWav(samples: Float32Array, sampleRate: number, format: 'float32' | 'pcm16' = 'float32'): ArrayBuffer {
  const bytesPerSample = format === 'float32' ? 4 : 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))

  text(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format === 'float32' ? 3 : 1, true) // 3 = IEEE float, 1 = PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, bytesPerSample * 8, true)
  text(36, 'data')
  view.setUint32(40, dataSize, true)
  samples.forEach((sample, i) => {
    const offset = 44 + i * bytesPerSample
    if (format === 'float32') view.setFloat32(offset, sample, true)
    else view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true)
  })
  return buffer
}

/** Reads the first channel of a PCM 16-bit, PCM 24-bit or float 32-bit WAV file. */
export function decodeWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(buffer)
  const text = (offset: number) => String.fromCharCode(...new Uint8Array(buffer, offset, 4))
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('Not a WAV file.')

  let offset = 12
  let format = 0
  let channels = 1
  let sampleRate = 0
  let bits = 0
  while (offset + 8 <= buffer.byteLength) {
    const id = text(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      if (format === 0xfffe) format = view.getUint16(body + 24, true) // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      const bytesPerSample = bits / 8
      const frames = Math.floor(size / (bytesPerSample * channels))
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        const at = body + i * bytesPerSample * channels
        if (format === 3 && bits === 32) samples[i] = view.getFloat32(at, true)
        else if (format === 1 && bits === 16) samples[i] = view.getInt16(at, true) / 32768
        else if (format === 1 && bits === 24) {
          const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)
          samples[i] = value / 8388608
        } else throw new Error(`Unsupported WAV format (format ${format}, ${bits} bits).`)
      }
      return { samples, sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('The WAV file has no audio data.')
}
