// Runs on Netlify every 5 minutes (UTC), only on the published site.
// - Liveness (/api/health/live) every time: the API server answers, and Render's free server stays
//   awake (it sleeps after 15 minutes without a visitor), so students don't wait for it to wake.
// - Readiness (/api/health/ready) every 6 hours (the runs at 00:00, 06:00, 12:00 and 18:00 UTC):
//   the database answers and has every table change. Not more often: each check wakes the Neon
//   database for about 5 minutes, which counts towards the free plan's compute hours (every
//   6 hours ≈ 4 CU-hours a month of the 100); when they run out, the database stops until the
//   next month.
// Results are in Netlify: Logs → Functions → health-check.

/** The API server itself (not through the website), so it is the server that is kept awake. */
const API_URL = process.env.HEALTH_CHECK_API_URL ?? 'https://melantha-guitar-api.onrender.com'
/** Netlify may stop a scheduled function after about 10 seconds, so each check waits at most 8. */
const TIMEOUT_MS = 8000

export type CheckResult = { check: 'live' | 'ready'; ok: boolean; status: number | null; ms: number; detail: string }

async function check(name: CheckResult['check'], fetchFn: typeof fetch, apiUrl: string): Promise<CheckResult> {
  const started = Date.now()
  try {
    const response = await fetchFn(`${apiUrl}/api/health/${name}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    const detail = (await response.text()).slice(0, 300)
    return { check: name, ok: response.ok, status: response.status, ms: Date.now() - started, detail }
  } catch (error) {
    // A sleeping server takes about a minute to wake; this request has started it waking.
    const errorName = (error as { name?: unknown } | null)?.name
    const timedOut = errorName === 'TimeoutError' || errorName === 'AbortError'
    const detail = timedOut ? `no answer within ${TIMEOUT_MS / 1000} s (the server is probably waking up)` : String(error)
    return { check: name, ok: false, status: null, ms: Date.now() - started, detail }
  }
}

/** Readiness every this many hours (in the first 5-minute run of the hour). */
const READY_EVERY_HOURS = 6

/** Liveness always; readiness every 6 hours. Both at once (time limit). */
export async function runHealthChecks(now: Date, fetchFn: typeof fetch = fetch, apiUrl: string = API_URL): Promise<CheckResult[]> {
  const readyNow = now.getUTCHours() % READY_EVERY_HOURS === 0 && now.getUTCMinutes() < 5
  const checks: CheckResult['check'][] = readyNow ? ['live', 'ready'] : ['live']
  return Promise.all(checks.map((name) => check(name, fetchFn, apiUrl)))
}

export default async function handler(): Promise<Response> {
  const results = await runHealthChecks(new Date())
  for (const result of results) {
    const line = `${result.check}: ${result.ok ? 'OK' : 'PROBLEM'} (${result.status ?? 'no answer'}, ${result.ms} ms) ${result.detail}`
    if (result.ok) console.log(line)
    else console.error(line)
  }
  return Response.json({ results })
}

export const config = { schedule: '*/5 * * * *' }
