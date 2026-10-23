// Saving a diagnostic practice recording: sound (WAV) + decision log (JSON).
// During development the phone sends both files straight to the computer running the dev server
// (see dev/saveRecordingsPlugin.ts). If that is not available, they can be downloaded instead.

import type { PracticeRecording } from './listeningSession'
import { encodeWav } from './wav'

const ENDPOINT = '/__dev/recordings'

export type RecordingFiles = { baseName: string; wav: Blob; json: Blob }

export function recordingFiles(recording: PracticeRecording, now = new Date()): RecordingFiles {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return {
    baseName: `practice-${stamp}`,
    wav: new Blob([encodeWav(recording.samples, recording.sampleRate)], { type: 'audio/wav' }),
    json: new Blob([JSON.stringify(recording.log)], { type: 'application/json' }),
  }
}

/** Sends both files to the computer. Resolves to the saved paths, or throws if not possible. */
export async function sendToComputer(files: RecordingFiles): Promise<string[]> {
  const saved: string[] = []
  for (const [extension, blob] of [['wav', files.wav], ['json', files.json]] as const) {
    const response = await fetch(`${ENDPOINT}?name=${files.baseName}.${extension}`, { method: 'POST', body: blob })
    if (!response.ok) throw new Error(`The computer did not accept the file (${response.status}).`)
    saved.push(((await response.json()) as { saved: string }).saved)
  }
  return saved
}

export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
