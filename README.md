# Guitar Practice

A mobile-first web app for guitar students: pick a song written in the instructor's numbering system
(`13` = string 1, fret 3), see each note on a fretboard, and (from Phase 2) get real-time feedback from the
phone's microphone.

- Design and roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Supported song files: [docs/song-formats.md](docs/song-formats.md)

## Status

| Phase | State |
|---|---|
| 0 – Architecture | Done |
| 1 – Guitar mapping, songs, fretboard, navigation | Done (frontend only) |
| 2 – Microphone pitch detection | Done (confirmed on a real guitar) |
| 3 – Guided practice (auto-advance, error sound) | Done; needs real-guitar check |
| 4–6 | Not started |

## Requirements

- Node.js 22+ and npm

## Run the app

```bash
cd frontend
npm install
npm run dev          # open http://localhost:5173
```

### Open it on your phone (with the microphone)

Phone browsers only allow the microphone on secure (`https://`) addresses, so use the phone mode:

1. Computer and phone on the **same Wi-Fi** (not mobile data, not a "guest" network).
2. Run `npm run dev:phone`. It prints, for example:
   ```
   ➜  Local:   https://localhost:5174/
   ➜  Network: https://192.168.1.14:5174/
   ```
3. On the phone, open Chrome and type the **Network** address exactly (`https://` and `:5174`).
4. Chrome warns **"Your connection is not private"**. This is expected: the development certificate is
   made on your own computer, not by a public authority. Tap **Advanced → Proceed to 192.168.1.14 (unsafe)**.
   Only do this for your own computer's address.
5. Open a song, tap **Start listening** and allow the microphone.

`npm run dev` (plain `http://…:5173`) still works on the phone for everything except the microphone.

If the phone can't open the address at all:
- The terminal must show a `Network:` line. (The dev server is configured with `host: true` for this.)
- Windows Firewall: the Wi-Fi network must be **Private**, and "Node.js" allowed on private networks
  (Settings → Privacy & security → Windows Security → Firewall → Allow an app through firewall).
- Some routers block devices from talking to each other ("AP/client isolation"); try another Wi-Fi or a phone hotspot.
- The computer's address can change after a restart; always use the one the terminal prints.

### If notes are not detected

1. Open **Detection details** while playing. "Result" says *too quiet* or *unclear*; the level bar has a
   thin mark: sound left of it is treated as silence.
2. Too quiet: tick **Boost a quiet microphone** (before starting), move the microphone closer, and on
   Windows check *Settings → System → Sound → (your microphone) → Audio enhancements / Voice clarity: Off*.
3. Save a **test recording** (Detection details → Save a 6-second test recording; keep quiet for the first
   second, then play) and analyse it:
   ```bash
   cd frontend
   npm run analyse -- "C:\Users\<you>\Downloads\guitar-test-....wav"
   ```
   It prints what the detector heard over time and which notes it recognised.

### Adding songs to the built-in library

Put song files in [frontend/src/songs/library/](frontend/src/songs/library/README.md). Each file becomes a song automatically.

## Tests

```bash
cd frontend
npm test                          # unit + component tests (Vitest)
npx playwright install chromium   # first time only
npm run test:e2e                  # browser tests: desktop, 360×640 phone, and a fake microphone
npm run typecheck
npm run lint
```

## Project layout

```
docs/        architecture and file-format documentation
fixtures/    test data shared by frontend and (later) backend tests
frontend/    React + TypeScript + Vite app
  src/music/      pure guitar/pitch logic (numbering, tuning, MIDI ⇄ frequency)
  src/audio/      microphone, YIN pitch detection, note recognition
  src/songs/      song types, validation, sample songs, file parsers, storage
  src/practice/   practice session state, target matching
  src/components/ fretboard, note timeline, listening panel
  src/pages/      screens
  tests/e2e/      Playwright tests
```
