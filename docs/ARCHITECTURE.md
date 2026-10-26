# Guitar Practice App — Phase 0: Requirements & Architecture

Status: **draft for review** (2026-10-22). Nothing here is implemented yet.

---

## 1. What we are building (summary)

A mobile-first web app where a guitar student:

1. Picks a song (built-in library or an imported note file).
2. Sees the expected notes in the instructor's numbering system (`13` = string 1, fret 3).
3. Puts the phone near the guitar and plays. The browser listens, detects pitch, and compares it with the current expected note.
4. Correct → green "Correct ✓", advance **once**, no sound.
   Wrong → "Wrong ✗" + expected vs. detected + one short error sound, **no advance**.
5. Can jump to any note, step back/forward, or reset at any time, without stopping the microphone.
6. Can use it fully by keyboard / screen reader, with optional spoken guidance.

Later: accounts, saved practice history, instructor review.

### What the app will *not* claim

- It hears **pitch**, not fingers. A G3 played as `30` (string 3 open) or `45` (string 4 fret 5) sounds the same. We show the *intended* position and judge only the *pitch*.
- It does not transcribe ordinary recordings (MP3 of a band) into tabs. That is a research problem, out of scope.
- v1 is **single notes only** (monophonic). Chords need polyphonic detection, which is much less reliable; deferred.

---

## 2. Assumptions (proceeding with these unless told otherwise)

| # | Assumption |
|---|---|
| A1 | **Frets ≥ 10**: the first digit is always the string (1–6), the remaining digits are the fret. `112` = string 1, fret 12; `60` = string 6 open. Unambiguous because a string is always one digit. UI also shows it split ("1 · 12") so it is readable. *(Confirmed by project owner.)* |
| A1b | **No chords in v1** (decided 2026-10-22). The numbering system is melodic (one note at a time) and monophonic detection is far more reliable. A song is a sequence of single notes; a future "chord step" type can be added without changing the guitar-number logic. |
| A2 | Standard tuning E2 A2 D3 G3 B3 E4 by default; tuning is data, so others can be added later. |
| A3 | Frets 0–24 supported, max configurable. |
| A4 | English for UI and spoken guidance in v1; text kept in one place so translation is possible later. |
| A4b | **Sinhala songs are mandatory** (confirmed 2026-10-22). Practice is language-independent (it compares pitches), so any song works once written as guitar numbers or tab. Song titles and files must fully support Sinhala Unicode: UTF-8/UTF-16 file decoding, zero-width-joiner-insensitive search, Sinhala font fallbacks. Legacy non-Unicode Sinhala fonts (e.g. "FM" fonts) are not supported. |
| A4c | The owner's test phone is **Android** (Chrome). Phase 2 is tuned and manually verified on it first. |
| A5 | Phases 1–4 run **frontend-only** (no server needed to practise). Backend arrives in Phase 5. The app keeps working without an account. |
| A6 | Target browsers: current Chrome/Edge/Firefox desktop, Chrome on Android, Safari on iOS 15+. |
| A7 | Sample songs are **original practice melodies** written for this app (scales, simple exercises, short tunes), labelled as samples. Public-domain folk melodies (e.g. "Ode to Joy" melody) may be added with the arrangement marked as ours. |

---

## 3. System architecture

```
┌──────────────────────────── Browser (React + TS) ─────────────────────────────┐
│                                                                                │
│  Pages / UI components  ◄──── Practice session (useReducer, pure logic)        │
│        │  ▲                         ▲                       │                  │
│        │  │ state                   │ NoteEvent             │ side effects     │
│        ▼  │                         │                       ▼                  │
│   Song library ── songs/ ──┐   Note recognizer          Feedback: error beep,  │
│   (samples, imports)       │   (stability, onset,       aria-live, speech      │
│                            │    debounce)                                      │
│                            │        ▲ PitchFrame                               │
│   music/  (pure: tuning,   │   Pitch detector (YIN)  ◄── AudioWorklet frames   │
│    guitar numbers, MIDI)◄──┘        ▲                                          │
│                                getUserMedia (mic) — audio never leaves device  │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │ JSON over HTTPS (Phase 5+)
                          ┌─────────────▼─────────────┐      ┌──────────────┐
                          │ FastAPI: auth, songs,     │─────►│ PostgreSQL   │
                          │ imports, practice history │      └──────────────┘
                          └───────────────────────────┘
```

**Key idea for a beginner:** the hard, time-critical work (listening and judging notes) happens on the phone, inside the browser, 20–40 times a second. Sending audio to a server would add network delay, cost, and privacy risk. The server only stores *data* (songs, users, progress), which is small and not time-critical.

### Layering rules

- `music/`, `songs/`, `audio/pitchDetector`, `audio/noteRecognizer`, `practice/` are **plain TypeScript with no React** → unit-testable with fake data.
- React components only render state and dispatch actions.
- The audio pipeline is a small class living outside React; the practice page subscribes to it. This stops React re-renders from interfering with audio timing.

### Technology choices inside the given stack

| Concern | Choice | Why |
|---|---|---|
| Routing | React Router | Standard, small. |
| State | `useReducer` + context for the practice session | Explicit states without adding Redux. |
| Styling | CSS Modules + CSS custom properties (design tokens) | Scoped styles, no runtime cost, easy theming/high-contrast. |
| Audio processing | `AudioWorklet` (fallback: `AnalyserNode` polling) | Runs off the main UI thread, so a busy UI doesn't drop audio. |
| Pitch algorithm | **YIN** | See §6. |
| Speech | Web Speech API `speechSynthesis` | Built into browsers, free, offline on most phones. |
| Error sound | Synthesised with Web Audio (no audio file) | Tiny, configurable volume/length, no asset loading. |
| Backend (Phase 5) | FastAPI, Pydantic v2, SQLAlchemy 2.x, Alembic, `argon2-cffi` for password hashing | As specified. |

---

## 4. Folder structure

```
Guitar/
├── README.md
├── docs/
│   ├── ARCHITECTURE.md          ← this file
│   └── song-formats.md          ← exact import formats (Phase 1)
├── frontend/
│   ├── index.html
│   ├── vite.config.ts
│   ├── playwright.config.ts
│   ├── src/
│   │   ├── main.tsx, App.tsx, routes.tsx
│   │   ├── music/               # pure: no React, no browser APIs
│   │   │   ├── pitch.ts             MIDI ⇄ frequency ⇄ note name, cents
│   │   │   ├── tuning.ts            Tuning type, STANDARD_TUNING
│   │   │   ├── guitarNumber.ts      parse/format "13" ⇄ {stringNumber, fret}
│   │   │   └── fretboard.ts         position → MIDI, MIDI → all positions, validation
│   │   ├── songs/
│   │   │   ├── types.ts             Song, SongNote
│   │   │   ├── validation.ts
│   │   │   ├── sampleSongs.ts
│   │   │   ├── songRepository.ts    interface + local implementation (API later)
│   │   │   └── parsers/
│   │   │       ├── guitarNumberText.ts   "10 12 13 | 20 22"
│   │   │       └── asciiTab.ts           6-line ASCII tab
│   │   ├── audio/               # Phase 2
│   │   │   ├── microphone.ts        permission, getUserMedia, AudioContext
│   │   │   ├── pitch-worklet.ts     AudioWorkletProcessor: collects frames
│   │   │   ├── pitchDetector.ts     pure YIN: (samples, sampleRate) → PitchFrame
│   │   │   ├── noteRecognizer.ts    pure: PitchFrame stream → NoteEvent
│   │   │   ├── audioPipeline.ts     wires the above together
│   │   │   └── errorSound.ts
│   │   ├── practice/            # Phase 3
│   │   │   ├── practiceReducer.ts   explicit state machine
│   │   │   ├── matching.ts          compare NoteEvent with target
│   │   │   └── usePracticeSession.ts
│   │   ├── a11y/                # Phase 4
│   │   │   ├── LiveAnnouncer.tsx    aria-live region
│   │   │   ├── speech.ts            queued, de-duplicated speech
│   │   │   └── phrases.ts           all spoken/announced text
│   │   ├── components/
│   │   │   ├── fretboard/Fretboard.tsx
│   │   │   ├── timeline/NoteTimeline.tsx
│   │   │   └── ui/ (Button, StatusBadge, …)
│   │   ├── pages/  Home, Library, Import, SongDetail, Practice
│   │   ├── api/                 # Phase 5: typed fetch client
│   │   └── styles/ tokens.css, global.css
│   └── tests/
│       ├── fixtures/            # shared JSON + WAV fixtures
│       └── e2e/                 # Playwright
└── backend/                     # Phase 5
    ├── pyproject.toml, .env.example, alembic.ini
    ├── alembic/versions/
    ├── app/
    │   ├── main.py, config.py, db.py
    │   ├── api/routes/   health.py, songs.py, imports.py, sessions.py, auth.py
    │   ├── schemas/      Pydantic request/response models
    │   ├── models/       SQLAlchemy models
    │   ├── services/     business logic (routes stay thin)
    │   ├── music/        Python port of tuning/guitar-number logic
    │   ├── importers/    ascii_tab.py, midi.py, musicxml.py
    │   └── auth/         hashing, tokens, permission checks
    └── tests/
```

**Duplication note:** guitar-number and tuning logic will exist in TypeScript (for the UI) and Python (for server validation). It is ~60 lines each. To stop them drifting, both test suites load the same root-level `fixtures/guitar-mapping.json` file of expected conversions.

**As built in Phase 1:** routing and layout live in `src/app/` (`routes.tsx`, `Layout.tsx`); import logic is in `src/songs/importSong.ts`; imported songs are stored in the browser's localStorage behind the `SongRepository` interface until Phase 5.

---

## 5. Data model and API

### 5.1 Core types (frontend, Phase 1)

```ts
type Tuning = {
  id: string;                    // "standard"
  name: string;                  // "Standard (E A D G B E)"
  openStringMidi: Record<StringNumber, number>; // {1:64, 2:59, 3:55, 4:50, 5:45, 6:40}
  maxFret: number;               // 24
};

type StringNumber = 1 | 2 | 3 | 4 | 5 | 6;
type GuitarPosition = { stringNumber: StringNumber; fret: number };

type SongNote = {
  index: number;                 // 0-based order in the song
  midi: number;                  // expected pitch; E4 = 64
  position: GuitarPosition | null; // null only while an import is awaiting confirmation
  durationBeats?: number;
  measure?: number;
  beat?: number;
};

type Song = {
  id: string;
  title: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  tuningId: string;
  source: 'sample' | 'import';
  description?: string;
  notes: SongNote[];
};
```

`midi` is the single source of truth for comparison. When a position is known, validation checks `midi === openStringMidi[string] + fret`.

Frequency: `f = 440 × 2^((midi − 69) / 12)`. Range on standard tuning: E2 = 82.4 Hz (`60`) up to E6 = 1318.5 Hz (string 1, fret 24).

### 5.2 Database (Phase 5) — only what is needed

| Table | Key fields |
|---|---|
| `users` | id, email (unique), password_hash, display_name, role (`student`/`instructor`), created_at |
| `songs` | id, owner_id (nullable = public sample), title, difficulty, tuning_id, source, status (`draft`/`ready`), created_at |
| `song_notes` | id, song_id, sequence_index, midi, string_number (nullable), fret (nullable), duration_beats, measure, beat — unique (song_id, sequence_index) |
| `practice_sessions` | id, user_id, song_id, started_at, ended_at, last_position, furthest_position, wrong_note_count, completed |

Deliberately left out for now:
- `song_imports` table → an import simply creates a `songs` row with `status='draft'` until positions are confirmed.
- `instructors` table → a `role` column is enough. `practice_submissions` is added in Phase 6.
- Per-note event logs → not stored; a session summary is enough until there is a real need.

### 5.3 REST API (Phase 5, prefix `/api/v1`)

| Method & path | Purpose | Auth |
|---|---|---|
| `GET /health` | liveness + DB check | — |
| `GET /songs?q=&difficulty=&page=` | list/search visible songs | optional |
| `GET /songs/{id}` | song + notes | owner or public |
| `POST /songs/imports` (multipart, ≤ 256 KB, `.txt` / `.mid` / `.musicxml`) | parse → draft song, or `422` with line-numbered errors | required |
| `PATCH /songs/{id}/notes` | confirm/adjust positions of a draft | owner |
| `POST /songs/{id}/publish` | draft → ready (rejects if any position missing) | owner |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | accounts | — / required |
| `POST /practice-sessions` | start a session | required |
| `PATCH /practice-sessions/{id}` | save progress | owner |
| `GET /practice-sessions?song_id=` | own history | owner |

Error format everywhere: `{"error": {"code": "invalid_tab", "message": "…", "details": [{"line": 3, "message": "…"}]}}`.
Auth: httpOnly, Secure, SameSite cookie session (avoids storing tokens in JS). Exact choice is finalised in Phase 5.

---

## 6. Real-time detection and note comparison

### 6.1 Why YIN

| Option | Verdict |
|---|---|
| FFT peak picking | Simple but often picks a harmonic instead of the fundamental — common on guitar low strings. ✗ |
| Plain autocorrelation | Works, but prone to octave errors and has no natural confidence value. |
| **YIN** | Autocorrelation-family method with fixes for octave errors **and** a built-in "how periodic is this" value we use as confidence. Well documented, ~80 lines, fast enough on phones. ✓ |
| McLeod (MPM) | Similar quality to YIN; kept as a fallback if YIN tests poorly on real recordings. |
| ML models (CREPE etc.) | Heavier download and CPU, not needed for clean single guitar notes. ✗ |

### 6.2 Pipeline

```
mic ─► AudioWorklet ─► frame (2048 samples ≈ 43 ms @48 kHz, hop ≈ 21 ms)
        │
        ▼
  Pitch detector (YIN, search 70–1400 Hz)
        → PitchFrame { time, freq | null, clarity 0..1, rms }
        │
        ▼
  Note recognizer (state machine)
   1. Gate: rms below noise floor  OR clarity < threshold  → "unreliable", ignored
   2. Convert freq → fractional MIDI (e.g. 63.92)
   3. Stability: the last N reliable frames agree within ±35 cents → a candidate note
   4. Onset: emit a NoteEvent only if this is a *new* note:
        - pitch moved to a different semitone, OR
        - energy re-attacked (rms jumped after decaying) — needed for repeated notes "13 13 13", OR
        - silence/release happened since the last event
   5. After emitting, "lock": the ringing note can't produce another event
        → NoteEvent { midi, cents, freq, time }
        │
        ▼
  Practice reducer: compare with target note
```

Starting values (to be **tuned with real recordings**, not trusted as final):

| Parameter | Start value |
|---|---|
| Window / hop | 2048 / 1024 samples |
| YIN threshold | 0.15 |
| Min clarity | 0.85 |
| Noise floor | measured during a 1-second "stay quiet" calibration when practice starts; gate = max(0.01, 3 × floor) |
| Stability frames — correct note | 3 (≈ 65 ms) |
| Stability frames — wrong note | 5 (≈ 110 ms) — deliberately stricter so noise rarely causes a false alarm |
| Match tolerance | ≤ 40 cents from target → correct |
| Wrong threshold | ≥ 60 cents from target → wrong; 40–60 cents → "slightly out of tune" hint, no beep, no advance |
| Error-sound cooldown | 800 ms, and never twice for the same sustained note |

### 6.3 Comparison rules

- Compare **pitch numbers** (fractional MIDI → cents difference), never note-name strings.
- **Octave differences are wrong**, not correct. The detector adds a sub-harmonic check to reduce *its own* octave mistakes; if the detected note is exactly ±12 semitones from the target, the feedback says "right note name, wrong octave" but does not advance. A setting can relax this later if real tests show detector octave errors on certain phones.
- Correct: green + "✓ Correct" + advance once. No sound.
- Wrong: red + "✗ Wrong: expected G3 (30), heard A3 220 Hz" + one beep. Stay on the note.

### 6.4 Practice state machine

```
 idle ──start──► requestingMic ──granted──► calibrating ──► listening ◄───────┐
                     │ denied/unavailable                     │  NoteEvent     │
                     ▼                                        ▼                │
               micUnavailable                         correct / incorrect ─────┘
                                                              │ last note correct
 listening ──pause──► paused ──resume──► listening            ▼
                                                          completed
```
Navigation actions (`next`, `prev`, `jumpTo(i)`, `reset`) are valid in **every** state. Each one:
1. sets the new target immediately,
2. clears feedback,
3. calls `recognizer.reset({ requireFreshOnset: true })` — so a note still ringing from before the jump can't count against or toward the new target,
4. leaves the microphone running.

### 6.5 Self-feedback protection

The phone's speaker and mic are centimetres apart, so the app could "hear" its own error beep or spoken guidance. While the beep or speech is playing (plus ~150 ms), recognizer input is muted. The beep is also designed as a non-musical buzz that YIN scores as low clarity.

### 6.6 Mobile handling

- `AudioContext` is created/resumed inside the Start button's tap (iOS requirement).
- `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })` — phone voice-call processing distorts music pitch.
- Screen Wake Lock API (where supported) keeps the screen on during practice.
- When the tab is hidden or the phone locks, practice auto-pauses; resume needs a tap.
- HTTPS required in production (`localhost` is allowed in development; testing on a real phone in development uses Vite's `--host` with a local HTTPS certificate).

---

## 7. Technical risks

| Risk | Impact | Mitigation / how we test |
|---|---|---|
| Pitch accuracy differs by phone mic | Wrong judgements | Thresholds are config values; a dev-only screen shows live freq/clarity/rms; test on ≥ 1 Android + 1 iPhone with a real guitar. |
| Repeated identical notes (`13 13`) not separated | Song gets stuck | Energy re-attack onset detection; WAV fixtures with repeated plucks. |
| Sustained note advances twice | Breaks core rule | Lock-until-onset in recognizer; unit test with a 3-second synthetic sustain. |
| Noise / talking causes false wrong-note beeps | Annoying, breaks trust | Noise calibration, clarity gate, stricter wrong-note stability, cooldown; tests with white noise and speech fixtures. |
| Octave errors on low E/A strings | Wrong-note alarms on correct playing | YIN + sub-harmonic check; fixture tests per string; dedicated octave feedback. |
| App hears its own beep/speech | Fake detections | Mute recognizer during playback (§6.5). |
| iOS Safari audio quirks | Mic doesn't start | Gesture-started context, worklet fallback, manual test checklist on iOS. |
| Out-of-tune student guitar | Everything "wrong" | 40–60 cent dead zone + "out of tune" hint; a tuner view later. |
| Screen reader + speech talk over each other | Confusing for blind users | One announcement queue; speech off by default when a screen reader user chooses "screen reader only". Manual tests with TalkBack and VoiceOver. |

**Testing levels (kept clearly separate in every phase report):**
- *Automated unit*: mapping, parsers, YIN on synthetic sine/sawtooth/noise signals, recognizer on scripted frame sequences, reducer rules.
- *Automated fixture*: real guitar WAV clips (recorded once, stored in `tests/fixtures/`) run through detector + recognizer in Vitest.
- *Automated browser*: Playwright with a fake microphone (Chromium can feed a WAV file as the mic) for the full practice flow.
- *Manual, real device*: real guitar on real phones — required before calling detection "accurate".

---

## 8. Phase 1 plan — Guitar mapping, song data, fretboard, navigation

**Objective:** a working frontend where a student opens a sample or imported song, sees every note as a custom number + note name, sees the intended position on a fretboard, and can navigate through the song. No microphone yet.

### Files

| Area | Files |
|---|---|
| Setup | `frontend/` Vite React-TS scaffold, ESLint, Prettier, Vitest, RTL, Playwright config, root `README.md`, `.gitignore`, `git init` |
| Music logic | `music/pitch.ts`, `tuning.ts`, `guitarNumber.ts`, `fretboard.ts` + tests |
| Songs | `songs/types.ts`, `validation.ts`, `sampleSongs.ts` (4–5 original exercises), `songRepository.ts` + tests |
| Import | `parsers/guitarNumberText.ts` (instructor's numbers, e.g. `30 32 | 20 21 23`), `parsers/asciiTab.ts` (6-line tab, single notes) + tests, `docs/song-formats.md` |
| UI | `Fretboard.tsx`, `NoteTimeline.tsx`, `LibraryPage`, `ImportPage`, `SongDetailPage`, `PracticePage` (navigation only, mic placeholder clearly labelled "coming in Phase 2"), `HomePage` |
| Fixtures | `tests/fixtures/guitar-mapping.json` |

MIDI and MusicXML import are deferred to Phase 5 (server-side, where Python libraries make them reliable). They produce pitches without positions, which needs the "confirm positions" step — that step is designed in Phase 1 types (`position: null`) but its UI is built with those importers.

### Acceptance criteria

- [ ] `parseGuitarNumber("13")` → string 1, fret 3; `"60"` → string 6, fret 0; `"112"` → string 1, fret 12; `"70"`, `"1"`, `"1x"`, `"125"` (fret > 24) → clear errors.
- [ ] Every string/fret 0–24 on standard tuning maps to the correct MIDI, note name and frequency (e.g. `10` → E4 329.63 Hz, `65` → A2 110.00 Hz, `25` → E4, same pitch as `10`).
- [ ] `positionsForMidi(64)` returns all valid positions (`10`, `25`, `39`, `414`, `519`, `624`).
- [ ] Sample songs pass validation; a song with a mismatched midi/position fails with a helpful message.
- [ ] Both import formats accept valid files and reject invalid ones with line/column-specific messages; chords in ASCII tab are rejected with "chords are not supported yet".
- [ ] Library lists songs and filters by title search.
- [ ] Fretboard labels strings 1–6, shows fret numbers, highlights the expected position with a marker + text label (not colour only), shows open strings distinctly.
- [ ] Timeline: current note indicated; prev/next with boundary handling; tap any note to jump; reset to start is a separate button; fretboard updates in sync.
- [ ] Keyboard: every control reachable, visible focus; timeline notes have accessible names like "Note 5 of 12: 13, string 1 fret 3, G4".
- [ ] Layout usable at 360 × 640 px without horizontal scroll.
- [ ] `npm test` and a Playwright smoke test (open sample → navigate → reset) pass and are actually run.

---

## 8b. Phase 2 as built

- **Audio capture:** `AnalyserNode` polled every 25 ms (not an AudioWorklet). Simpler, works on every
  target browser, and frames are skipped if no new audio arrived. The detector is pure code, so it can
  move to a Worker later if a phone proves too slow (the details panel shows analysis time per frame).
- **Chain:** `audio/pitchDetector.ts` (YIN) → `audio/pitchTracker.ts` (noise calibration, gate, clarity)
  → `audio/noteRecognizer.ts` (steady readings, one event per pluck, re-pluck and release detection,
  overtone-jump filtering, reset with "fresh onset required") → `practice/matching.ts`.
- **Events:** `noteStart` after 3 steady readings (≈75 ms), `noteConfirmed` after 5. Phase 3 accepts a
  correct note on `noteStart` and only calls a note wrong on `noteConfirmed`.
- **Phone HTTPS:** `npm run dev:phone` (self-signed certificate via `@vitejs/plugin-basic-ssl`, port 5174).
- **Testing:** generated plucked-string audio (Karplus–Strong, `src/test/synth.ts`) runs through the
  exact live chain in Vitest; Playwright runs the real browser pipeline with a generated WAV as a fake
  microphone. Real-guitar validation on Android is still required.
- **Bug found by these tests:** an octave-wrong first reading of a new pluck could lock out the real
  pitch. Fixed (overtone filtering applies only to established notes) and covered by a regression test.

## 8c. Phase 3 as built

- `practice/practiceReducer.ts` holds the rules: correct on `noteStart` (advance once, `handledNoteId`
  stops its confirmation counting again), wrong only on `noteConfirmed`, "out of tune" is a hint only,
  completion after the last note, and every position change bumps `positionVersion`.
- The practice page resets detection on every `positionVersion` change (fresh pluck required), so a
  ringing note never satisfies the next target, including repeated notes such as `10 10`.
- Error sound: two clashing square-wave tones for 0.18 s through the microphone's AudioContext; detection
  is paused for the sound plus 250 ms of echo; at most one sound per 0.8 s; can be switched off
  (remembered per device). There is no success sound.
- Practice states map to: listening status (idle/starting/calibrating/listening/error = Ready, Paused,
  Listening, Microphone unavailable) × feedback (none/correct/incorrect/out-of-tune) × completed.
- Verified with a fake microphone in Chromium (counting oscillators to prove one sound per wrong note and
  none for correct notes). Not verifiable with a fake microphone: the phone hearing its own error sound
  through the speaker; needs a real-device check.

## 8d. Real-guitar feedback round (after Phase 3)

Problems reported on a real guitar: correct notes sometimes not caught, notes 62 cents sharp called wrong.

- **Out-of-tune tolerance:** up to 70 cents counts as correct (tuning hint above 40); 70+ is wrong. A wrong
  fret on a reasonably tuned guitar is ~100 cents away.
- **Root cause of missed notes:** on a real guitar the previous string keeps ringing; two notes blend and the
  blind pitch estimate becomes unclear or reports a lower "common" pitch. Reproduced with a new
  multi-string performance synthesiser (`perform()` in `src/test/synth.ts`).
- **Pluck (onset) detection:** high-frequency "attack level" in the newest ~21 ms of each frame; a
  note can only be reported within 160 ms of a pluck, and each pluck reports at most one note.
- **Expected-note check:** the detector also measures how strongly the *expected* pitch is present
  (`matchAt`). Used only right after a pluck, only when the blind estimate is unclear or lower, and
  only if the pluck made the expected pitch stronger (or the song repeats the note), so a string
  still ringing at that pitch never counts.
- **Practice simulation tests** (`performance.test.ts`): a simulated student plays whole songs through
  the real chain and reducer. Measured limits: Ode to Joy at 0.22 s/note; scale at 0.3 s/note; open
  strings all left ringing at 0.4 s/note. Faster than that fails only with several strings ringing.
- **Practice screen:** Listen/Pause in the bottom bar, the next four notes shown, mic status in the
  note card, so practice needs no scrolling on a phone.

## 8e. Phase 3.5: detection quality on real recordings

- **Diagnostic practice recorder** (`PracticeRecorder`, `ListeningSession.startRecording`): sound +
  log of every frame and decision; the dev server saves both into `recordings/` (dev-only plugin
  `frontend/dev/saveRecordingsPlugin.ts`). Recordings are personal and git-ignored.
- **Measurement** (`src/audio/realRecordings.test.ts`, skipped without recordings): every pluck is
  labelled with hindsight; reports how many correct plucks are accepted, false acceptances and latency,
  and replays whole-song practice. Guard rails: ≥ 44/52 correct plucks, ≤ 1 false acceptance,
  play-through reaches the end of every recorded run.
- **Findings (5 recordings, Android phone):** string 2 ~70 cents sharp, other strings 20–40; plucks
  on string 6 instead of string 1 (same fret, two octaves lower); 0.43 s deaf period after the error
  sound; a missed note made note-by-note practice stall (fast run: stuck at note 4, 29 "wrong").
- **Changes kept (each measured):** pluck window 200 ms (81% → 85%, no new false acceptances);
  per-string tuning compensation (learned from correct notes, ±50 cents); error sound 0.12 s +
  0.12 s pause, with plucks during the pause recovered (louder or different note); **play-through
  mode** with one note of look-ahead (all recorded runs reach the end; two notes of look-ahead caused
  false jumps); wrong-string, "again", thinnest/thickest and Play-again hints.
- **Tried and rejected:** "shortest nearly-best period" (McLeod key maximum) rule: no measurable
  gain on real recordings (85.7% vs 85.9% agreement), so the simpler detector was kept.

## 8f. Second recording round (3 new runs, play-through)

- Whole-song replay is the main yardstick (per-pluck labels miss short notes and count re-plucks).
- Fixes from the newest runs: one pluck no longer counts twice (onset refractory 100 ms); a short,
  soft note counts after 2 readings when it is clearly an expected note (≥ 0.78). Result: run 3 now
  plays through with no skipped notes; correct plucks 78% → 85%; typical response 102 → 85 ms.
- Remaining skips/wrong notes in the newest runs were played that way (wrong string, badly fretted
  note), checked one by one.
- **Test with a recording:** `ListeningSession.startFromFile` plays an audio file aloud and analyses
  the file directly (no microphone, no room-noise calibration, no self-hearing pause), so an expert's
  recording can be checked against a song in the library.

## 8g. Phase 4 (in progress): chords and common song formats

- **4.1 Chord steps:** `SongNote.chord` (tones with positions, optional name, simplification note)
  and `SongNote.lyric`. Notation `[53 42 30 21 10]` (thickest string first). `music/chords.ts`:
  chord name → shape (open shapes, E/A movable barre shapes, slash-chord bass, simplification),
  numbers ↔ positions, chord naming from numbers.
- **4.2 Import:** one paste box with automatic format detection (`detectFormat`); chord charts over
  lyrics, ChordPro and UG markup (`parsers/chordChart.ts`); tab columns with several strings and
  bracketed numbers become chords; preview with chord names, numbers and words.
- **4.3 Chord checking:** single-note periodicity cannot see notes in a 5–6 string strum (measured
  0.2–0.4), so chords use the spectrum: 8192-sample FFT, peak picking with interpolation (no
  leakage into neighbouring semitones), per-note-name salience in 75–700 Hz. Verdict "match" when
  every expected note name sounds and no foreign low note got louder with the strum (strings still
  ringing from the previous chord are ignored); "other" when a note is clearly missing or a foreign
  note is strong (the heard chord is named). `ChordRecognizer`: one decision per strum.
  Synthetic results: 12 chords recognised, 9 typical mix-ups rejected, chord songs followed at 1.2 and
  0.8 s per chord. **Real strummed recordings still needed.**
- Practice: chord steps are judged only by chord events; play-through skips work across chords and
  notes; wrong chord → "Not this chord. Expected C, heard G" + error sound.
- **First recording (owner's playback of the generated demo, play-through):** live run made 3 false
  "wrong chord" calls and skipped ahead at chord changes. Cause: right after a strum the analysis slice
  still holds the previous chord, whose ringing notes and overtones can pass for the next chord (C → G).
  Fixes: decide matches only after 100 ms; the expected chord's notes must get louder (absolute level —
  relative strength drops after a strum because the attack raises the background); call a chord wrong
  only after 250 ms. Replay of that recording: 22/22 chords, 0 wrong, 0 skipped in both modes (guarded).
- Chart parsing: one blank line allowed between chords and words; labels/separators never taken as words.
- Next: 4.4 Guitar Pro / MusicXML (alphaTab), 4.5 tuning on real strum recordings.

### 8h. Look and feel (Melantha Guitar Academy)

- Dark stage theme only (amber accent, purple/blue glows, Oswald headings), branded for the artist
  Melantha with his photos in `src/assets/brand/`.
- A glowing guitar drawing (`decor/GuitarArt`) sits fixed behind every page; cards are frosted glass
  (`backdrop-filter`) so the guitar shows through. The stage gradient is on `html` so the backdrop
  (z-index -1) is visible.
- `PageBanner` on Songs (with photo), Add a song and Song details; Songs is a numbered "set list" with
  pick-shaped difficulty and chord/note counts.
- Song cards: amber album-style cover tile with the track number, guitar-string strip, Sinhala badge,
  compact glass "Practise" button.
- Home: `HeroSlideshow` cross-fades two photos (slow zoom, sweeping stage light, motivational caption;
  pause button and dots, no auto-play with reduced motion). "How it works" as three icon steps joined
  by a glowing string; "How the numbers work" shows 13 split into a STRING and a FRET digit, a fretboard,
  example tiles and the six strings drawn thin to thick. "Melantha's corner" practice tips with photo.
- Add a song: three format tiles with tiny samples (the recognised one lights up), a 1-2-3
  Paste/Check/Practise progress line, the form as a glass "studio" panel with a lined-paper paste box.
- Practice (phone first): progress bar and "N in a row" streak chip (reducer `streak`/`bestStreak`);
  the note in a glowing ring with string/fret/note chips beside it, so the fretboard is visible above
  the sticky frosted control bar on a 360×640 screen; mode switch moved below the note card; Pause
  pulses green while listening; completion shows 1–3 picks (no / ≤3 / more wrong notes) and the best
  run; "Boost" and "Test with a recording" folded into "More options".
- Practice: small level bars move with the microphone; `PickBurst` (8 picks out of the ring) on every
  correct note; the `Celebration` pick shower on song completion and at every 5 in a row.
  All decoration is `aria-hidden`, and motion is off with `prefers-reduced-motion`.

### 8i. Spoken guidance and song sheets (Word / PDF)

- Spoken guidance (`practice/speech.ts`): a "Voice" switch on the note card says each new step with
  the browser's speech ("String 1, fret 3.", "A minor chord.", "Song complete. Well done!"). Note by
  note mode only. While the phone talks, `ListeningSession.setSpeaking` ignores the microphone (at
  most 5 s, plus 150 ms echo), so the app does not hear its own voice as a note.
  After a wrong note or chord (after the error sound) it says the correction
  (`correctionToSpeech`): "Wrong note. Play string 1, open.", "Wrong string. Use string 1, the
  thinnest string." (string 6 played instead of 1, or the reverse), "Wrong chord. Play C major."
- Play through with Voice on: only a fast "Wrong" (rate 1.6, at most every 1.5 s) after a mistake;
  no announcements or corrections (they would hold the song up).
- "What you played" (`components/practice/PlayedStrip.tsx`): the reducer keeps a `record` per step
  (every wrong try with the note/chord heard, and the result: correct / skipped). Shown under the
  note card: green = right first time, red = had a mistake (stays red after it was played right,
  with "you: G4"), grey = skipped (play-through catch-up or Next). Tapping a chip jumps there; the
  "All notes" timeline shows the same marks. Kept until Restart.
- Same note on different strings (client finding, e.g. 10 = 25 = E4, 20 = 34 = B3, 11 = 26 = F4):
  identical pitch, so detection cannot tell which string was used. The practice card now says so
  ("25 and 39 sound the same… play it on string 1 as shown", `samePitchPositions`, up to fret 12),
  feedback says "Correct note!" / "Correct chord!", and Home explains it. String detection from
  timbre (inharmonicity, per-guitar calibration) is only to be tried after measuring it on the
  client's recordings of these pairs.
- Song sheets (`songs/parsers/songSheet.ts`, format `song-sheet`): numbers lines with the words line
  underneath, words matched by count; mismatches become preview warnings (`ImportResult.warnings`),
  never guesses. `detectFormat`: numbers lines mixed with text → song sheet.
- Word/PDF upload (`songs/documentText.ts`): `.docx` via fflate + DOMParser, PDF via pdf.js (loaded
  only when a PDF is chosen; its worker is a separate file). The text goes into the paste box with
  "Read from <file>"; the saved song's description records the file. Verified on the client's
  Riversheen "Twinkle, twinkle" sheet (`sharedSongs/`, not committed): Word and PDF both give all
  42 notes and every syllable, with no warnings (guarded tests, skipped without the folder).
- Browser tests run with 2 workers: more overloaded the dev server on this laptop (pages timed out,
  also on older commits).

### 8j. Step B1: accounts (server + database)

- Plan (owner-approved, 2026-10-25): FastAPI + PostgreSQL. Frontend stays on Netlify, which
  forwards `/api/*` to the API on Render (free plan; sleeps after 15 min, ~1 min to wake, app shows
  "Waking up the server…"). Database on Neon (free). Steps: B1 accounts, B2 global + own songs and
  search, B3 request → admin review (approve / reject / edit and approve), B4 saved practice (only
  when the user saves; last 2 per song), B5 password reset + email check, load test (500 users).
- Rules: guests practise global songs only; users manage only their own songs; only the admin
  edits/deletes global songs; admin accounts only from the command line; sign-up asks name, email,
  password; progress is private.
- B1 as built (`backend/`): tables `users` and `auth_sessions` (Alembic `0001_accounts`); argon2
  passwords; a random session key in an httpOnly / Secure / SameSite=Lax cookie (path /api), only
  its SHA-256 stored, 30 days; every change needs `X-Requested-With: fetch`; 10 failed sign-ins per
  email or address in 15 min → 429; friendly 422 messages per field; `python -m app.cli create-admin`.
  Neon pooled connections: psycopg prepared statements off.
- Frontend: `api/client.ts` (header, timeouts, waking notice), `AuthProvider`/`useAuth`,
  `/signin` and `/signup` pages (glass card with Melantha), header account button (initials, panel
  with Sign out, Admin badge), welcome banner with a pick burst. Header stays one row down to 320 px.
- Tests: backend pytest on a real PostgreSQL (20), frontend unit tests with a fake server, and a
  full-stack browser test against the real API when it runs on localhost:8000.

### 8k. Step B2: global songs, my songs, search

- Table `songs` (Alembic `0002_songs`): scope `global` (owner empty; only the admin changes it) or
  `private` (one owner); title, optional artist/description/difficulty, the text it was made from
  (`source_text`, for editing), notes (JSONB, same shape as the app), counts, `search_text`
  (title + artist, NFC, without zero-width joiners, lower case) with a pg_trgm index.
- Every song is checked on the server: pitch = string + fret in standard tuning, chords on
  different strings and pointing at the lowest, steps in order, ≤ 2000 steps, sizes limited,
  unknown fields refused.
- API: `GET /api/songs?scope=global|mine&q=` (global for everyone), `GET/PUT/DELETE /api/songs/{id}`,
  `POST /api/songs` (scope `global` admin only), `POST /api/songs/move-from-device`. Someone else's
  own song answers 404 (also for the admin).
- Built-in songs: `npm run export:songs` writes `backend/app/seed/global_songs.json` with the app's
  own converter; `python -m app.cli seed-songs` (run on every deploy) adds each once (`seed_log`), so
  admin edits/deletions stay. A test fails if the JSON drifts from the app's songs.
- Frontend `AppSongRepository`: server first; the global list and recently opened global songs are
  kept on the phone (starting with the built-in songs), so the list shows instantly and practice
  works offline or while the server wakes. Old phone-saved songs show as "📱 On this phone" with
  "Move to my account". Guests can "Practise without saving" (`/songs/draft/practice`); the Add a
  song draft survives signing up.
- Pages: Songs tabs (🌍 Global set list | 🎸 My songs, `?list=mine`), search by title or artist
  (debounced 300 ms), badges; Add a song: Artist and Difficulty (optional), admin "Save to"; edit
  page `/songs/:id/edit` (the Add a song page filled in); detail page Edit / Delete (asks first).

### 8l. Step B3: sharing a song with everyone (request → admin review)

- Table `share_requests` (Alembic `0003`): song, requester, status pending/approved/rejected,
  `snapshot` (the song exactly as sent), optional `reason`, reviewer, time, `global_song_id`.
  A partial unique index allows one waiting request per song.
- API: `POST/DELETE /api/songs/{id}/share` (owner: send / withdraw), admin `GET /api/share-requests`
  (`state=pending|reviewed`), `GET /api/share-requests/{id}`, `POST …/approve` (optional corrected
  song = edit and approve; checked like any song) and `POST …/reject` (optional reason). Approving
  creates a NEW global song (owner empty, `created_by` = requester); the user's own song stays
  theirs and later edits don't change the global copy. Own songs return `shareStatus`/`shareReason`.
- App: on own song cards a 🌍 share icon (asks first), status strip (⏳ waiting + Withdraw,
  ✓ shared, ✗ not accepted + admin's reason, share again); same on the song page. Admin: third tab
  "📥 Requests" with a count, request cards (sender, time), review page (Approve, Edit and approve,
  Reject with optional reason, Try it), pick shower on approval.

## 9. Later phases (unchanged from the brief, condensed)

2. Microphone + YIN + recognizer + live debug readout.
3. Practice rules, error sound, navigation during listening, all Section 7/8 rules.
4. Accessibility + mobile refinement, speech guidance, device testing.
5. FastAPI + PostgreSQL + Alembic, accounts, song persistence, MIDI/MusicXML import, history.
6. Instructor submissions/review, deployment docs (HTTPS, CORS, env config).
