// Development-only helper: lets the phone send a diagnostic practice recording straight into the
// project's `recordings/` folder on this computer, instead of copying files by hand.
// It exists only while `npm run dev` / `npm run dev:phone` is running; it is not part of the
// built app. Only files named like "practice-20261023-134501.wav|json" up to 60 MB are accepted.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

export const RECORDINGS_ENDPOINT = '/__dev/recordings'
const MAX_BYTES = 60 * 1024 * 1024
const SAFE_NAME = /^practice-\d{8}-\d{6}\.(wav|json)$/

export function saveRecordingsPlugin(folder: string): Plugin {
  return {
    name: 'guitar-practice-save-recordings',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(RECORDINGS_ENDPOINT, (req, res) => {
        const reply = (status: number, body: object) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
        const name = new URL(req.url ?? '', 'http://local').searchParams.get('name') ?? ''
        if (!SAFE_NAME.test(name)) return reply(400, { error: 'Invalid file name.' })

        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BYTES) {
            reply(413, { error: 'Recording is too large.' })
            req.destroy()
          } else {
            chunks.push(chunk)
          }
        })
        req.on('end', () => {
          if (size > MAX_BYTES) return
          mkdirSync(folder, { recursive: true })
          writeFileSync(resolve(folder, name), Buffer.concat(chunks))
          reply(200, { saved: `recordings/${name}` })
        })
      })
    },
  }
}
