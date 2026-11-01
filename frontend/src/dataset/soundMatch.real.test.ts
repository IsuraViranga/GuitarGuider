/// <reference types="node" />
// Sound match on the client's dataset recordings (datasets/collector-b2, copied with
// backend `python -m app.dataset_download`; personal and not in git, so skipped without them).
// Each guitar: every recording through the live tracker; each take round (1st, 2nd, 3rd pluck of
// every place) is judged with the other two rounds as that guitar's recordings, after the string
// check, as practice would. The guitar setup comes from that guitar's open-string plucks.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { judgeString, MAX_STRING_MISFIT, planStringCheck, type GuitarStrings, type Stiffness } from '../audio/stringCheck'
import { decodeWav } from '../audio/wav'
import type { GuitarPosition } from '../music/guitarNumber'
import { STANDARD_TUNING, type StringNumber } from '../music/tuning'
import { createSoundMatch, fingerprint, fitsSetup, MAX_MATCHED_FRET, measureRecording, type Reference } from './soundMatch'

const FOLDER = '../datasets/collector-b2'
const available = existsSync(`${FOLDER}/labels.jsonl`)

type Pluck = { guitar: string; position: GuitarPosition; round: number; stiffness: Stiffness }

function measureAll(): Pluck[] {
  const labels = readFileSync(`${FOLDER}/labels.jsonl`, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  labels.sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)))
  const seen = new Map<string, number>()
  const plucks: Pluck[] = []
  for (const r of labels) {
    const position = { stringNumber: r.string_number as StringNumber, fret: r.fret as number }
    const place = `${r.guitar_name}|${r.string_number}-${r.fret}`
    const round = (seen.get(place) ?? 0) % 3
    seen.set(place, (seen.get(place) ?? 0) + 1)
    const bytes = readFileSync(`${FOLDER}/${r.audio_key}`)
    const { samples, sampleRate } = decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const stiffness = measureRecording(samples, sampleRate, STANDARD_TUNING.openStringMidi[position.stringNumber] + position.fret)
    if (stiffness) plucks.push({ guitar: r.guitar_name, position, round, stiffness })
  }
  return plucks
}

/**
 * The setup as if the player kept plucking each open string until 3 clean plucks agree (the setup
 * page allows up to 8 tries): clean plucks at frets 0–2 scaled back to open, the 3 nearest their middle.
 */
function setupOf(plucks: Pluck[]): GuitarStrings {
  const strings: GuitarStrings = { open: {}, misfit: {} }
  for (const s of [1, 2, 3, 4, 5, 6] as StringNumber[]) {
    const clean = plucks
      .filter((p) => p.position.stringNumber === s && p.position.fret <= 2 && p.stiffness.b > 0 && p.stiffness.misfit <= MAX_STRING_MISFIT)
      .map((p) => ({ b: p.stiffness.b / 2 ** (p.position.fret / 6), misfit: p.stiffness.misfit }))
    if (clean.length < 3) continue
    const middle = [...clean].sort((a, b) => a.b - b.b)[clean.length >> 1].b
    const near = [...clean].sort((a, b) => Math.abs(a.b - middle) - Math.abs(b.b - middle)).slice(0, 3)
    if (!near.every((p) => Math.abs(p.b - middle) <= 0.15 * middle)) continue
    strings.open[s] = middle
    strings.misfit![s] = near.map((p) => p.misfit).sort((a, b) => a - b)[1]
  }
  return strings
}

const same = (a: GuitarPosition, b: GuitarPosition) => a.stringNumber === b.stringNumber && a.fret === b.fret

/** Correct plucks called wrong and wrong places caught: the string check alone, and with the sound match. */
function score(plucks: Pluck[]) {
  const setup = setupOf(plucks)
  const t = { right: 0, falseToday: 0, falseWith: 0, wrong: 0, caughtToday: 0, caughtWith: 0 }
  for (let round = 0; round < 3; round++) {
    const references: Reference[] = plucks.filter((p) => p.round !== round).flatMap((p) => {
      const v = fingerprint(p.stiffness)
      return v ? [{ ...p.position, v }] : []
    })
    const match = createSoundMatch(references)!
    for (const pluck of plucks.filter((p) => p.round === round && p.position.fret <= MAX_MATCHED_FRET)) {
      const v = fingerprint(pluck.stiffness)
      const others = [1, 2, 3, 4, 5, 6]
        .map((s) => ({ stringNumber: s as StringNumber, fret: pluck.position.fret + STANDARD_TUNING.openStringMidi[pluck.position.stringNumber] - STANDARD_TUNING.openStringMidi[s as StringNumber] }))
        .filter((q) => q.stringNumber !== pluck.position.stringNumber && q.fret >= 0 && q.fret <= MAX_MATCHED_FRET)
      for (const q of others) {
        // Expected at its own place (played right), then expected at q (played at the wrong place).
        for (const expected of [pluck.position, q]) {
          const check = planStringCheck(expected, setup, STANDARD_TUNING)
          const today = check ? judgeString(check, pluck.stiffness) : { result: 'unsure' as const }
          const added = today.result === 'unsure' && v ? match.judge(expected, v) : null
          const says = today.result === 'other' ? today.heard : added
          if (same(expected, pluck.position)) {
            t.right++
            t.falseToday += today.result === 'other' ? 1 : 0
            t.falseWith += says ? 1 : 0
          } else {
            t.wrong++
            t.caughtToday += today.result === 'other' && same(today.heard, pluck.position) ? 1 : 0
            t.caughtWith += says && same(says, pluck.position) ? 1 : 0
          }
        }
      }
    }
  }
  return t
}

describe.skipIf(!available)('sound match on the collected recordings', { timeout: 300_000 }, () => {
  const plucks = available ? measureAll() : []
  const results = Object.fromEntries([...new Set(plucks.map((p) => p.guitar))].map((g) => [g, score(plucks.filter((p) => p.guitar === g))]))
  console.log('sound match on the collected recordings', results)

  it('never calls a correct pluck wrong that the string check alone did not', () => {
    for (const [guitar, t] of Object.entries(results)) expect(t.falseWith, guitar).toBe(t.falseToday)
  })

  it("a guitar's recordings fit its own setup, and never another guitar's (so they are not used there)", () => {
    const refsOf = (guitar: string): Reference[] =>
      plucks.filter((p) => p.guitar === guitar).flatMap((p) => {
        const v = fingerprint(p.stiffness)
        return v ? [{ ...p.position, v }] : []
      })
    const setupFor = (guitar: string) => setupOf(plucks.filter((p) => p.guitar === guitar))
    expect(fitsSetup(refsOf('No name'), setupFor('No name'))).toBe(true)
    expect(fitsSetup(refsOf('No name'), setupFor('Sqoe'))).toBe(false)
    expect(fitsSetup(refsOf('Sqoe'), setupFor('No name'))).toBe(false)
  })

  it('"No name": wrong places caught go up by at least 15 points, with no false call', () => {
    const t = results['No name']
    expect(t.falseWith).toBe(0)
    expect((t.caughtWith - t.caughtToday) / t.wrong).toBeGreaterThanOrEqual(0.15)
  })
})
