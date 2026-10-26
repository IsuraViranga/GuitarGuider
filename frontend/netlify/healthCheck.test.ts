import { describe, expect, it, vi } from 'vitest'
import handler, { config, runHealthChecks } from './functions/health-check.mts'

const API = 'https://api.example.com'
const answer = (status: number, body: object) => async () => new Response(JSON.stringify(body), { status })
const fakeFetch = (fn: (url: string | URL | Request) => Promise<Response>) => vi.fn<typeof fetch>(fn)

describe('the 5-minute health check (Netlify scheduled function)', () => {
  it('runs every 5 minutes', () => {
    expect(config.schedule).toBe('*/5 * * * *')
  })

  it('checks liveness only, most of the time (the database can sleep)', async () => {
    const fetchFn = fakeFetch(answer(200, { status: 'alive' }))
    const results = await runHealthChecks(new Date('2026-10-27T10:35:00Z'), fetchFn, API)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.example.com/api/health/live')
    expect(results).toMatchObject([{ check: 'live', ok: true, status: 200, detail: '{"status":"alive"}' }])
  })

  it('readiness only every 6 hours: not in other hours, even on the hour', async () => {
    for (const time of ['2026-10-27T11:00:00Z', '2026-10-27T13:00:00Z', '2026-10-27T05:55:00Z', '2026-10-27T06:05:00Z']) {
      const fetchFn = fakeFetch(answer(200, { status: 'alive' }))
      await runHealthChecks(new Date(time), fetchFn, API)
      expect(fetchFn.mock.calls.map((call) => String(call[0])), time).toEqual([`${API}/api/health/live`])
    }
  })

  it('also checks readiness at 00:00, 06:00, 12:00 and 18:00 UTC', async () => {
    const fetchFn = fakeFetch(async (url) =>
      String(url).endsWith('/ready') ? new Response('{"status":"ready"}', { status: 200 }) : new Response('{"status":"alive"}', { status: 200 }),
    )
    const results = await runHealthChecks(new Date('2026-10-27T12:00:00Z'), fetchFn, API)
    expect(fetchFn.mock.calls.map((call) => String(call[0]))).toEqual([`${API}/api/health/live`, `${API}/api/health/ready`])
    for (const time of ['2026-10-27T00:02:00Z', '2026-10-27T06:00:00Z', '2026-10-27T18:04:59Z']) {
      const each = fakeFetch(answer(200, {}))
      await runHealthChecks(new Date(time), each, API)
      expect(each, time).toHaveBeenCalledTimes(2)
    }
    expect(results.map((r) => [r.check, r.ok])).toEqual([
      ['live', true],
      ['ready', true],
    ])
  })

  it('reports a database problem from readiness', async () => {
    const fetchFn = fakeFetch(async (url) =>
      String(url).endsWith('/ready') ? new Response('{"status":"not ready","database":"unreachable"}', { status: 503 }) : new Response('{}', { status: 200 }),
    )
    const [, ready] = await runHealthChecks(new Date('2026-10-27T18:02:00Z'), fetchFn, API)
    expect(ready).toMatchObject({ check: 'ready', ok: false, status: 503, detail: '{"status":"not ready","database":"unreachable"}' })
  })

  it('a sleeping server (no answer in time) is reported as waking up, not as a crash', async () => {
    const fetchFn = fakeFetch(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    const [live] = await runHealthChecks(new Date('2026-10-27T10:35:00Z'), fetchFn, API)
    expect(live).toMatchObject({ ok: false, status: null, detail: 'no answer within 8 s (the server is probably waking up)' })
  })

  it('the function logs each result and answers with them', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(answer(200, { status: 'alive' }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await handler()
    expect(response.status).toBe(200)
    expect(log.mock.calls[0][0]).toMatch(/^live: OK \(200, \d+ ms\)/)
  })
})
