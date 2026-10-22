// Runs a recording through the exact detection chain the app uses and prints what it found.
//
//   npm run analyse -- path/to/guitar-test.wav [--clarity 0.8] [--gate 0.0005]
//
// Use it with the "test recording" files saved from the app's Detection details.

import { readFileSync } from 'node:fs'
import { midiToNoteName } from '../src/music/pitch'
import { analyseSignal, DEFAULT_TRACKER_CONFIG, type PitchReading } from '../src/audio/pitchTracker'
import { decodeWav } from '../src/audio/wav'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--'))
if (!file) {
  console.error('Usage: npm run analyse -- <recording.wav> [--clarity 0.8] [--gate 0.0005]')
  process.exit(1)
}
const option = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? Number(args[index + 1]) : undefined
}

const bytes = readFileSync(file)
const { samples, sampleRate } = decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const config = {
  ...DEFAULT_TRACKER_CONFIG,
  minClarity: option('clarity') ?? DEFAULT_TRACKER_CONFIG.minClarity,
  minGate: option('gate') ?? DEFAULT_TRACKER_CONFIG.minGate,
}
const { readings, events, tracker } = analyseSignal(samples, sampleRate, { config })

const db = (rms: number) => `${(20 * Math.log10(Math.max(rms, 1e-7))).toFixed(0)} dB`
const sorted = (values: number[]) => [...values].sort((a, b) => a - b)
const percentile = (values: number[], p: number) => (values.length ? sorted(values)[Math.floor((values.length - 1) * p)] : NaN)
const peak = samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0)
const levels = readings.map((r) => r.rms)

console.log(`\n${file}`)
console.log(`  ${(samples.length / sampleRate).toFixed(1)} s at ${sampleRate} Hz, peak ${peak.toFixed(4)} (${db(peak)})`)
console.log(`  level: median ${percentile(levels, 0.5).toFixed(4)}, loudest 10% ${percentile(levels, 0.9).toFixed(4)} (${db(percentile(levels, 0.9))})`)
console.log(`  noise gate after calibration: ${tracker.gate.toFixed(4)} (${db(tracker.gate)}); clarity needed: ${config.minClarity}`)

const counted = readings.filter((r) => r.rejectReason !== null || r.reliable)
const count = (test: (r: PitchReading) => boolean) => counted.filter(test).length
console.log(`  readings: ${count((r) => r.reliable)} clear, ${count((r) => r.rejectReason === 'unclear')} unclear, ${count((r) => r.rejectReason === 'quiet')} too quiet`)
const audible = counted.filter((r) => r.rejectReason !== 'quiet').map((r) => r.clarity)
console.log(`  clarity of audible readings: median ${percentile(audible, 0.5).toFixed(2)}, best 10% ${percentile(audible, 0.9).toFixed(2)}`)

// Timeline: group consecutive readings with the same outcome.
console.log('\n  time          what was heard')
let group: { from: number; to: number; label: string; clarity: number[]; rms: number[] } | null = null
const flush = () => {
  if (!group) return
  const c = percentile(group.clarity, 0.5)
  const r = percentile(group.rms, 0.5)
  console.log(`  ${(group.from / 1000).toFixed(2)}–${(group.to / 1000).toFixed(2)} s  ${group.label.padEnd(26)} clarity ${c.toFixed(2)}  level ${r.toFixed(4)}`)
}
for (const r of readings) {
  const label =
    r.reliable && r.midi !== null
      ? `${midiToNoteName(Math.round(r.midi)).label} (${r.frequency!.toFixed(1)} Hz)`
      : r.rejectReason === 'unclear'
        ? `unclear${r.frequency ? ` (~${r.frequency.toFixed(0)} Hz)` : ''}`
        : r.rejectReason === 'quiet'
          ? 'too quiet'
          : 'calibrating'
  const key = label.replace(/\(.*\)/, '')
  if (group && group.label.replace(/\(.*\)/, '') === key) {
    group.to = r.time
    group.clarity.push(r.clarity)
    group.rms.push(r.rms)
  } else {
    flush()
    group = { from: r.time, to: r.time, label, clarity: [r.clarity], rms: [r.rms] }
  }
}
flush()

console.log('\n  notes recognised:')
const starts = events.filter((e) => e.type === 'noteStart')
if (starts.length === 0) console.log('  (none)')
for (const e of starts) console.log(`  ${(e.time / 1000).toFixed(2)} s  ${midiToNoteName(Math.round(e.midi)).label}  (${((e.midi - Math.round(e.midi)) * 100).toFixed(0)} cents)`)
console.log('')
