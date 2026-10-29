import { describe, expect, it } from 'vitest'
import type { LoggedFrame, PracticeRecording } from '../audio/listeningSession'
import { checkPluck, countsOf, DEFAULT_SESSION, expectedNote, loadSession, nextIncomplete, saveSession, woundLabel } from './pluck'

const frame = (t: number, onset = false): LoggedFrame => ({ t, hz: null, clarity: 0, rms: 0, midi: null, reliable: false, onset, matchedTarget: false, target: null })

function recording({ peak = 0.5, onsets = [700], heardMidi = 64 as number | null } = {}): PracticeRecording {
  const samples = new Float32Array(48000)
  samples[100] = peak
  const frames = Array.from({ length: 80 }, (_, i) => frame(i * 25, onsets.includes(i * 25)))
  const events = heardMidi === null ? [] : [{ t: onsets[0] ?? 0, kind: 'noteStart', noteId: 1, midi: heardMidi }]
  return { samples, sampleRate: 48000, log: { createdAt: '', userAgent: '', sampleRate: 48000, frameSize: 2048, intervalMs: 25, frames, events } }
}

describe('checking a take before saving', () => {
  it('one clear pluck: no warnings, and when it started', () => {
    expect(checkPluck(recording(), 64)).toEqual({ pluckAtMs: 700, peak: 0.5, warnings: [] })
  })

  it('warns about clipping, quiet sound, no pluck, several plucks, a pluck at the start and another note', () => {
    expect(checkPluck(recording({ peak: 1 }), 64).warnings[0]).toMatch(/Too loud/)
    expect(checkPluck(recording({ peak: 0.01 }), 64).warnings[0]).toMatch(/Very quiet/)
    const none = checkPluck(recording({ onsets: [], heardMidi: null }), 64)
    expect(none.warnings).toEqual(['No pluck was heard.'])
    expect(none.pluckAtMs).toBeNull()
    expect(checkPluck(recording({ onsets: [700, 1500] }), 64).warnings).toEqual(['2 plucks were heard. Retake for one clean pluck.'])
    // Onsets close together are one pluck.
    expect(checkPluck(recording({ onsets: [700, 750] }), 64).warnings).toEqual([])
    expect(checkPluck(recording({ onsets: [50] }), 64).warnings[0]).toMatch(/right at the start/)
    expect(checkPluck(recording({ heardMidi: 59 }), 64).warnings).toEqual(['Heard B3, expected E4. Check the string, the fret and the tuning.'])
  })
})

describe('positions', () => {
  it('expected note and frequency in standard tuning', () => {
    expect(expectedNote({ stringNumber: 2, fret: 5 })).toEqual({ midi: 64, label: 'E4', hz: 329.63 })
    expect(expectedNote({ stringNumber: 6, fret: 0 })).toEqual({ midi: 40, label: 'E2', hz: 82.41 })
  })

  it('the next position with fewer samples than the target, string by string up to fret 7', () => {
    const counts = countsOf([
      { stringNumber: 1, fret: 0, count: 5 },
      { stringNumber: 1, fret: 1, count: 5 },
      { stringNumber: 1, fret: 2, count: 2 },
    ])
    expect(nextIncomplete(counts, { stringNumber: 1, fret: 0 }, 5)).toEqual({ stringNumber: 1, fret: 2 })
    expect(nextIncomplete(counts, { stringNumber: 1, fret: 7 }, 5)).toEqual({ stringNumber: 2, fret: 0 })
    expect(nextIncomplete(counts, { stringNumber: 6, fret: 7 }, 5)).toEqual({ stringNumber: 1, fret: 2 })
    const all = new Map<string, number>()
    for (let s = 1; s <= 6; s++) for (let f = 0; f <= 7; f++) all.set(`${s}-${f}`, 3)
    expect(nextIncomplete(all, { stringNumber: 1, fret: 0 }, 3)).toBeNull()
  })

  it('wound or plain from the guitar', () => {
    expect(woundLabel([3, 4, 5, 6], 3)).toBe('wound')
    expect(woundLabel([4, 5, 6], 3)).toBe('plain')
    expect(woundLabel(null, 3)).toBe('wound?')
  })
})

describe('settings kept between recordings', () => {
  it('are remembered, and broken storage falls back to the defaults', () => {
    saveSession({ ...DEFAULT_SESSION, guitarId: 'g1', pluckMethod: 'pick', position: { stringNumber: 3, fret: 4 } })
    expect(loadSession()).toMatchObject({ guitarId: 'g1', pluckMethod: 'pick', backgroundNoise: 'quiet', position: { stringNumber: 3, fret: 4 } })
    localStorage.setItem('guitar-practice:dataset-session', '{broken')
    expect(loadSession()).toEqual(DEFAULT_SESSION)
  })
})
