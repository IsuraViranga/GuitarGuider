// k6 load test: pretend students using the app at the same moment, the way real students do.
//
// Run it with scripts/loadtest.sh (k6 in Docker), e.g.
//   bash scripts/loadtest.sh smoke https://<staging-api>.onrender.com
//
// Each pretend student (a k6 "virtual user") signs up once, then repeats: who am I, the song
// list, open a song, their saved practice, save a practice, My progress, their guitar setup,
// with pauses like a person reading and playing in between (the listening itself happens in the
// browser, so it costs the server nothing). Some students also sign out and in again, 1 in 20
// records a guitar pluck and plays it back (RECORDINGS=yes: students 1, 21, 41 …), and a few ask for a password reset.
//
// Every request is tagged by kind, so the targets differ:
//   normal  (reads, small writes)         95 % under 500 ms
//   heavy   (sign up / in: slow password   95 % under 2 s
//            hashing on purpose; save practice; upload)
//   audio   (a recording from storage)    measured on its own
// and fewer than 1 % of requests may fail.
//
// It creates real accounts and data, so it is for staging (or your own computer). It refuses the
// live site unless ALLOW_PRODUCTION=yes.

import http from 'k6/http'
import { check, fail, sleep } from 'k6'

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8000').replace(/\/$/, '')
const PROFILE = __ENV.PROFILE || 'smoke'
const RECORDINGS = (__ENV.RECORDINGS || 'no') === 'yes'
const RUN = __ENV.RUN_ID || `${Date.now()}`
const PRODUCTION = ['melantha-guitar-api.onrender.com', 'melantha-guitar-academy.netlify.app']

if (PRODUCTION.some((host) => BASE_URL.includes(host)) && __ENV.ALLOW_PRODUCTION !== 'yes') {
  throw new Error(`Refusing to load-test the live site (${BASE_URL}). Use staging, or set ALLOW_PRODUCTION=yes on purpose.`)
}

const ramp = (target, up, hold, down = '1m') => ({
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: up, target },
    { duration: hold, target },
    { duration: down, target: 0 },
  ],
  gracefulRampDown: '30s',
})

const PROFILES = {
  smoke: { executor: 'constant-vus', vus: 5, duration: '1m' },
  load50: ramp(50, '2m', '5m'),
  load100: ramp(100, '3m', '5m'),
  load250: ramp(250, '4m', '8m'),
  target500: ramp(500, '5m', '10m', '2m'),
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 50 },
      { duration: '2m', target: 50 },
      { duration: '30s', target: 500 }, // a class of students all opening the app at once
      { duration: '3m', target: 500 },
      { duration: '1m', target: 50 },
      { duration: '2m', target: 50 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '30s',
  },
  soak: ramp(Number(__ENV.SOAK_VUS || 150), '5m', __ENV.SOAK_TIME || '60m', '2m'),
}

if (!PROFILES[PROFILE]) throw new Error(`Unknown PROFILE "${PROFILE}". Use one of: ${Object.keys(PROFILES).join(', ')}`)

export const options = {
  scenarios: { students: PROFILES[PROFILE] },
  thresholds: {
    'http_req_failed{kind:normal}': ['rate<0.01'],
    'http_req_failed{kind:heavy}': ['rate<0.01'],
    'http_req_duration{kind:normal}': ['p(95)<500'],
    'http_req_duration{kind:heavy}': ['p(95)<2000'],
    'http_req_duration{kind:audio}': ['p(95)<10000'],
    checks: ['rate>0.99'],
  },
  // A student stays signed in between rounds (k6 would otherwise forget the cookie each round).
  noCookiesReset: true,
  setupTimeout: '2m',
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }
const CHANGE_HEADERS = { 'X-Requested-With': 'fetch' }

/** Pause like a person: between min and max seconds. */
const think = (min = 2, max = 6) => sleep(min + Math.random() * (max - min))

function request(method, path, body, kind, name, okStatuses = [200]) {
  const params = {
    headers: body === null ? CHANGE_HEADERS : JSON_HEADERS,
    tags: { kind, name },
    responseCallback: http.expectedStatuses(...okStatuses),
    timeout: '60s',
  }
  const response = http.request(method, `${BASE_URL}${path}`, body === null ? null : JSON.stringify(body), params)
  check(response, { [`${name}: ${okStatuses.join('/')}`]: (r) => okStatuses.includes(r.status) })
  return response
}

// One short pluck as a mono 16-bit WAV (1 s, 22.05 kHz, a 110 Hz tone that fades), for uploads.
function makePluck() {
  const rate = 22050
  const count = rate
  const buffer = new ArrayBuffer(44 + count * 2)
  const view = new DataView(buffer)
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + count * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, count * 2, true)
  for (let i = 0; i < count; i++) {
    const value = Math.sin((2 * Math.PI * 110 * i) / rate) * Math.exp(-3 * (i / rate)) * 0.6
    view.setInt16(44 + i * 2, Math.round(value * 32767), true)
  }
  return buffer
}
const PLUCK = makePluck()

// Each virtual user keeps its own account between its iterations (k6 keeps its cookies too).
const me = { email: '', signedUp: false, setupSaved: false, guitarId: '' }
const PASSWORD = 'load-test-1'

function signUp() {
  me.email = `k6-${RUN}-${__VU}@example.com`
  const response = request('POST', '/api/auth/signup', { name: `Load Student ${__VU}`, email: me.email, password: PASSWORD }, 'heavy', 'sign up', [201])
  me.signedUp = response.status === 201
}

function signOutAndIn() {
  request('POST', '/api/auth/signout', null, 'normal', 'sign out', [204])
  think(1, 3)
  request('POST', '/api/auth/signin', { email: me.email, password: PASSWORD }, 'heavy', 'sign in', [200])
}

function practise() {
  request('GET', '/api/auth/me', null, 'normal', 'who am I')
  const list = request('GET', '/api/songs?scope=global', null, 'normal', 'song list')
  const songs = list.status === 200 ? list.json('songs') : []
  if (!songs || songs.length === 0) return
  think()
  const songId = songs[Math.floor(Math.random() * songs.length)].id
  const song = request('GET', `/api/songs/${songId}`, null, 'normal', 'open a song')
  if (song.status !== 200) return
  request('GET', `/api/progress/${songId}`, null, 'normal', 'saved practice', [200, 404])
  request('GET', '/api/string-setup', null, 'normal', 'guitar setup', [200, 404])
  think(10, 30) // playing the song
  const steps = song.json('noteCount')
  const record = Array.from({ length: steps }, () => ({ wrong: [], result: Math.random() < 0.8 ? 'correct' : 'skipped' }))
  request('PUT', `/api/progress/${songId}`, { mode: 'strict', completed: true, wrongCount: 0, bestStreak: steps, skippedCount: 0, record }, 'heavy', 'save practice')
  think()
  request('GET', '/api/progress', null, 'normal', 'my progress')
}

function saveGuitarSetup() {
  const open = { 1: 3e-5, 2: 2e-5, 3: 4e-5, 4: 6e-5, 5: 9e-5, 6: 1.4e-4 }
  const misfit = { 1: 0.4, 2: 0.5, 3: 1.2, 4: 0.6, 5: 0.7, 6: 0.9 }
  request('PUT', '/api/string-setup', { open, misfit }, 'normal', 'save guitar setup')
  me.setupSaved = true
}

function recordAndPlay() {
  if (!me.guitarId) {
    const added = request('POST', '/api/dataset/guitars', { name: `k6 guitar ${__VU}` }, 'normal', 'add guitar', [201, 409])
    if (added.status === 201) me.guitarId = added.json('id')
    else {
      const mine = (request('GET', '/api/dataset/guitars', null, 'normal', 'guitar list').json() || []).find((g) => g.mine)
      if (mine) me.guitarId = mine.id
    }
    if (!me.guitarId) return
  }
  const meta = JSON.stringify({ guitarId: me.guitarId, stringNumber: 1, fret: Math.floor(Math.random() * 8) })
  const upload = http.post(
    `${BASE_URL}/api/dataset/samples`,
    { audio: http.file(PLUCK, 'pluck.wav', 'audio/wav'), meta },
    { headers: CHANGE_HEADERS, tags: { kind: 'heavy', name: 'upload a pluck' }, timeout: '60s' },
  )
  check(upload, { 'upload a pluck: 201': (r) => r.status === 201 })
  if (upload.status !== 201) return
  think(2, 4)
  const link = request('GET', `/api/dataset/samples/${upload.json('sample.id')}/audio-url`, null, 'normal', 'playback link')
  if (link.status !== 200) return
  const url = link.json('url')
  const audio = http.get(url.startsWith('http') ? url : `${BASE_URL}${url}`, { tags: { kind: 'audio', name: 'play a pluck' }, timeout: '60s' })
  check(audio, { 'play a pluck: 200': (r) => r.status === 200 })
}

function askForPasswordReset() {
  // At most 10 requests per address per hour (all virtual users share this computer's address).
  request('POST', '/api/auth/forgot-password', { email: me.email }, 'normal', 'forgot password', [202, 429])
}

export default function () {
  if (!me.signedUp) {
    signUp()
    if (!me.signedUp) {
      sleep(5)
      return
    }
  } else if (Math.random() < 0.1) {
    signOutAndIn()
  }
  if (!me.setupSaved) saveGuitarSetup()
  practise()
  if (RECORDINGS && __VU % 20 === 1) recordAndPlay()
  if (__VU % 100 === 1 && __ITER === 0) askForPasswordReset()
  think()
}

export function setup() {
  const live = http.get(`${BASE_URL}/api/health/ready`, { tags: { kind: 'setup', name: 'ready' }, timeout: '90s' })
  if (live.status !== 200) fail(`The server at ${BASE_URL} is not ready (${live.status}): ${live.body}`)
  console.log(`Profile ${PROFILE} against ${BASE_URL}, recordings: ${RECORDINGS ? 'yes' : 'no'}`)
}
