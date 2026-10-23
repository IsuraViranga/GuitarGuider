/// <reference types="node" />
// Detection measured on real practice recordings from the student's phone (recordings/*.wav +
// *.json, saved with the in-app practice recorder). The recordings are personal and not in git,
// so these tests are skipped when the folder is empty.
//
// Each pluck is labelled with hindsight: the expected note was really played if it is clearly
// present in the steady part of the note (50–350 ms after the pluck). The live detector then
// has to accept those plucks quickly and must not accept the others.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LoggedFrame } from './listeningSession'
import { createPitchDetector } from './pitchDetector'
import { PitchTracker } from './pitchTracker'
import { compareToTarget } from '../practice/matching'
import { createPracticeState, practiceReducer, type PracticeState } from '../practice/practiceReducer'
import { decodeWav } from './wav'

const FOLDER = '../recordings'
const names = existsSync(FOLDER) ? readdirSync(FOLDER).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []

type Log = { frames: LoggedFrame[]; sampleRate: number }

function load(name: string) {
  const bytes = readFileSync(`${FOLDER}/${name}.wav`)
  const { samples, sampleRate } = decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const log = JSON.parse(readFileSync(`${FOLDER}/${name}.json`, 'utf8')) as Log
  return { samples, sampleRate, log }
}

export type PluckResult = { t: number; target: number; played: boolean; accepted: boolean; latency: number | null }

/** Replays a recording through the current detection chain with the targets the app had live. */
export function measure(name: string): PluckResult[] {
  const { samples, sampleRate, log } = load(name)
  const frame = (t: number) => {
    const end = Math.round((t / 1000) * sampleRate)
    return end >= 2048 && end <= samples.length ? samples.subarray(end - 2048, end) : null
  }

  // 1. Hindsight labels for every pluck the live app noticed while a note was expected.
  const judge = createPitchDetector(sampleRate, 2048)
  const strengthAt = (t: number, midi: number) => {
    const f = frame(t)
    if (!f) return 0
    judge(f)
    return judge.matchAt(440 * 2 ** ((midi - 69) / 12), 70)?.strength ?? 0
  }
  const plucks = log.frames
    .filter((f) => f.onset && f.target !== null && f.rms > 0.012)
    .map((f) => {
      let best = 0
      for (let dt = 50; dt <= 350; dt += 25) best = Math.max(best, strengthAt(f.t + dt, f.target!))
      return { t: f.t, target: f.target!, played: best >= 0.85 }
    })

  // 2. Replay with the current tracker, frame for frame as live (muted frames skipped).
  const tracker = new PitchTracker(sampleRate, 2048)
  const accepted: Array<{ t: number; target: number }> = []
  let target: number | null = null
  for (const f of log.frames) {
    if (f.target !== target) {
      target = f.target
      tracker.resetNotes({ requireFreshOnset: true })
      tracker.setTarget(target)
    }
    const samplesForFrame = frame(f.t)
    if (f.muted || !samplesForFrame) continue
    for (const event of tracker.process(samplesForFrame, f.t).events) {
      if (event.type === 'noteStart' && target !== null && compareToTarget(event.midi, target).result === 'correct') {
        accepted.push({ t: f.t, target })
      }
    }
  }

  return plucks.map((p) => {
    const hit = accepted.find((a) => a.target === p.target && a.t >= p.t && a.t <= p.t + 300)
    return { ...p, accepted: Boolean(hit), latency: hit ? hit.t - p.t : null }
  })
}

describe.skipIf(names.length === 0)('real recordings from the student phone', { timeout: 120_000 }, () => {
  it('summary', () => {
    let played = 0
    let caught = 0
    let falseAccepts = 0
    const latencies: number[] = []
    for (const name of names) {
      const results = measure(name)
      const p = results.filter((r) => r.played)
      const c = p.filter((r) => r.accepted)
      const f = results.filter((r) => !r.played && r.accepted)
      played += p.length
      caught += c.length
      falseAccepts += f.length
      latencies.push(...c.map((r) => r.latency!))
      const missed = p.filter((r) => !r.accepted).map((r) => (r.t / 1000).toFixed(2))
      if (f.length) console.log('   false accepts at', f.map((r) => (r.t / 1000).toFixed(2)).join(', '))
      console.log(`${name}: correct plucks ${c.length}/${p.length} accepted; false accepts ${f.length}; missed at ${missed.join(', ') || '-'}`)
    }
    latencies.sort((a, b) => a - b)
    console.log(
      `TOTAL: ${caught}/${played} correct plucks accepted (${((100 * caught) / Math.max(1, played)).toFixed(0)}%), ` +
        `false accepts ${falseAccepts}, median latency ${latencies[latencies.length >> 1]?.toFixed(0)} ms`,
    )
    expect(played).toBeGreaterThan(0)
    // Guard rails measured on 2026-10-23 recordings: do not get worse.
    expect(caught / played).toBeGreaterThanOrEqual(44 / 52)
    expect(falseAccepts).toBeLessThanOrEqual(1)
  })
})

// Ode to Joy as the student played it in recordings 1–3 (MIDI pitch and string of each note).
const ODE = { midi: [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62], strings: [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 2, 2] }
const ODE_RECORDINGS = ['practice-20261023-142841', 'practice-20261023-143153', 'practice-20261023-143706'].filter((n) => names.includes(n))

/** Replays a whole recording through detection + practice rules, starting from note 1. */
export function practiseRecording(name: string, mode: 'strict' | 'flow') {
  const { samples, sampleRate, log } = load(name)
  const tracker = new PitchTracker(sampleRate, 2048)
  let state: PracticeState = createPracticeState(ODE.midi, ODE.strings, mode)
  const targetsFor = (s: PracticeState) => (s.completed ? [] : s.targets.slice(s.currentIndex, s.currentIndex + (mode === 'flow' ? 2 : 1)))
  tracker.setTargets(targetsFor(state))
  const timeline: string[] = []
  for (const f of log.frames) {
    const end = Math.round((f.t / 1000) * sampleRate)
    if (f.muted || end < 2048 || end > samples.length) continue
    for (const event of tracker.process(samples.subarray(end - 2048, end), f.t).events) {
      const before = state
      state = practiceReducer(state, { type: 'noteEvent', event })
      if (state.positionVersion !== before.positionVersion) {
        timeline.push(`${(f.t / 1000).toFixed(1)}s→${state.completed ? 'done' : state.currentIndex + 1}`)
        tracker.resetNotes({ requireFreshOnset: true })
        tracker.setTargets(targetsFor(state))
      } else if (state.feedbackId !== before.feedbackId && state.feedback.kind === 'incorrect') {
        timeline.push(`${(f.t / 1000).toFixed(1)}s✗`)
      }
    }
  }
  return { state, timeline }
}

describe.skipIf(ODE_RECORDINGS.length === 0)('whole-song practice on real recordings', { timeout: 120_000 }, () => {
  it.each(['strict', 'flow'] as const)('%s mode', (mode) => {
    for (const name of ODE_RECORDINGS) {
      const { state, timeline } = practiseRecording(name, mode)
      console.log(`${mode} ${name}: reached ${state.completed ? 'the END' : 'note ' + (state.currentIndex + 1)}, wrong ${state.wrongCount}, skipped ${state.skippedCount} | ${timeline.join(' ')}`)
      // Play-through must follow every recorded run to the end; note-by-note the normal-speed runs.
      if (mode === 'flow' || name !== 'practice-20261023-143706') expect(state.completed, `${mode} ${name}`).toBe(true)
    }
  })
})
