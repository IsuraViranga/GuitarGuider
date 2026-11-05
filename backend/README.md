# Melantha Guitar Academy API

FastAPI + PostgreSQL. Step B1: accounts (sign up, sign in, sign out, admin accounts).
Listening and pitch detection stay in the browser; the server only stores accounts (and, in later
steps, songs and saved practice).

## Run on your own computer

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt     # Windows (macOS/Linux: .venv/bin/pip)
cp .env.example .env                                   # then put your local database address in it
.venv/Scripts/alembic upgrade head                     # create the tables
.venv/Scripts/uvicorn app.main:app --reload            # http://localhost:8000/api/docs
```

The frontend's dev server (`npm run dev`) forwards `/api` to `http://localhost:8000`.

### Tests

They need a PostgreSQL database; by default `postgresql://postgres@localhost:55432/guitar_test`
(set `TEST_DATABASE_URL` to use another). Every table is emptied between tests.

```bash
.venv/Scripts/python -m pytest
```

## Admin accounts

Admins are never created on the website. Create one (or make an existing account admin):

```bash
.venv/Scripts/python -m app.cli create-admin --email you@example.com --name "Melantha"
```

It asks for the password twice. It works on whichever database `DATABASE_URL` points to: for the
live site, run it on your own computer with the **Neon** connection string (Render's free plan has
no Shell):

```bash
# Windows Git Bash / macOS / Linux (PowerShell: $env:DATABASE_URL="…")
DATABASE_URL="postgresql://…neon.tech/…?sslmode=require" .venv/Scripts/python -m app.cli create-admin --email you@example.com --name "Melantha"
```

## Songs

- `GET /api/songs?scope=global|mine&q=…`: the global set list (everyone) or your own songs; `q`
  searches title and artist (Sinhala-safe).
- `GET /api/songs/{id}`, `POST /api/songs` (`"scope": "global"` admin only), `PUT` and `DELETE`
  (owner, or admin for global songs), `POST /api/songs/move-from-device`.
- Every song is checked: each note must be exactly its string and fret in standard tuning.

### Built-in songs

`app/seed/global_songs.json` holds the app's built-in songs, made by the frontend
(`npm run export:songs`, after adding or changing a file in `frontend/src/songs/library/`).
`python -m app.cli seed-songs` adds each one to the global set list once (Render runs it on every
deploy); songs the admin changed or deleted are left alone.

## Password reset by email

"Forgot password?" on the sign-in page emails a link (`/reset-password#key`). The link works
once, for 30 minutes; using it sets the new password, signs out every other browser and signs in.
At most 3 emails per account per hour, and the answer is the same whether or not an account
uses the email (so nobody can find out who has an account).

Emails go through **Brevo**'s HTTP API (Render's free plan blocks SMTP, so Gmail/SMTP cannot be
used from there). Set up once:

1. Create a free account at brevo.com (300 emails a day).
2. **Senders, domains & dedicated IPs → Senders → Add a sender**: the address emails come from
   (e.g. your Gmail); Brevo sends it a confirmation email.
3. **SMTP & API → API keys → Generate a new API key**.
4. On Render (service → Environment) add `EMAIL_API_KEY` (the key) and `EMAIL_FROM` (the sender
   address), and check `APP_URL` is the website's address. Never put the key in the code or chat.

Without a key the "Forgot password?" page says reset by email is not ready. On your own computer
`EMAIL_LOG_LINKS=true` (in `.env`) prints the link in the server log instead of sending it.

## Guitar recordings (dataset collector)

`/record-guitar` lets every signed-in player record their own guitar (labelled single plucks);
the string check then compares same-sounding places with a recorded guitar, and the admin uses
the recordings for research (see docs/ARCHITECTURE.md, 8r). After deploying, the admin ticks
**Default guitar for players** on one guitar (Samples tab → choose the guitar).
The sound files go to a **private Backblaze B2 bucket** (free 10 GB, about 12,000 plucks; no card
needed). On your own computer `DATASET_STORAGE=local` (in `.env`) keeps them in
`../datasets/collector` instead (git-ignored). Set up B2 once:

1. Create a free account at backblaze.com (B2 Cloud Storage).
2. **Buckets → Create a Bucket**: a unique name (e.g. `melantha-guitar-dataset`), **Private**.
   Note its **Endpoint** (e.g. `s3.us-east-005.backblazeb2.com`); the region is the middle part
   (`us-east-005`).
3. **Application Keys → Add a New Application Key**: access to **that bucket only**, Read and
   Write. Copy the **keyID** and the **applicationKey** (shown once).
4. On Render (service → Environment) add `DATASET_STORAGE=s3`, `DATASET_S3_ENDPOINT`
   (`https://` + the endpoint), `DATASET_S3_REGION`, `DATASET_S3_BUCKET`, `DATASET_S3_KEY_ID` and
   `DATASET_S3_SECRET`. Never put the key in the code or chat.

Until all of them are set, the collector says storage is not set up and saves nothing.

**Copying the recordings to your computer** (for research):

1. In B2, add another application key: that bucket only, **Read Only**. Put it in your own
   `backend/.env` as `DATASET_S3_KEY_ID` / `DATASET_S3_SECRET`, with `DATASET_S3_ENDPOINT`,
   `DATASET_S3_REGION` and `DATASET_S3_BUCKET` (`.env` is never committed).
2. In the collector's **Samples** tab, press **⬇ JSONL** (all samples, no filter).
3. `python -m app.dataset_download path\to\guitar-dataset.jsonl` copies every sample that is not
   rejected to `../datasets/collector-b2` (git-ignored), with `labels.jsonl` next to the files.
   Run it again after more recording: files already copied are skipped.

## Health checks

| Address | Means | Uses the database |
| --- | --- | --- |
| `GET /api/health/live` | Liveness: the server runs and answers (`{"status":"alive"}`) | No |
| `GET /api/health/ready` | Readiness: the database answers and has every table change; `503` with the reason if not | Yes (wakes it) |
| `GET /api/health` | Render's own health check (unchanged) | No |
| `GET /api/health/db` | Older database check (unchanged) | Yes |

A Netlify scheduled function (`frontend/netlify/functions/health-check.mts`) calls liveness
every 5 minutes and readiness every 6 hours (00:00, 06:00, 12:00, 18:00 UTC); results are in Netlify → Logs → Functions →
health-check. The 5-minute calls keep Render's free server awake (no "Waking up the server…"
wait). That uses about 744 of the 750 free Render hours a month, so it only fits if this is the
only free Render service in the account. Readiness is every 6 hours, not every 5 minutes: each
check keeps the Neon database awake for about 5 minutes (≈ 4 of the free plan's 100 compute
hours a month at this pace), and an always-awake database would use more than the free plan
allows. To stop the checks, delete the function file (or remove its
`schedule`).

## Load test

`loadtest/load_test.py` makes many pretend students use the API at once (sign up, songs, a song,
save practice, My progress) and prints the time per request and any errors:

```bash
.venv/Scripts/python loadtest/load_test.py --users 500
```

It refuses a server that is not on this computer unless `--allow-remote` is given (it creates
real accounts). Results (October 2026) are in `docs/ARCHITECTURE.md` (8n).

**k6 (staging, realistic journeys).** `loadtest/k6/journeys.js` runs with k6 in Docker. Nothing
needs installing:

```bash
bash ../scripts/loadtest.sh smoke https://<staging-api>.onrender.com yes   # 5 students, 1 minute
# then load50, load100, load250, target500, spike (50 → 500 → 50), soak (150 for 60 min)
```

Each student signs up, practises songs, saves practice, reads their guitar setup, sometimes
signs in again; 1 in 20 records and plays back a pluck, and a few ask for a password reset.

Targets:
- normal requests: 95 % under 500 ms
- heavy ones (sign up and sign in, save, upload): 95 % under 2 s
- under 1 % errors

The live site is refused unless `ALLOW_PRODUCTION=yes`. Results go to `loadtest/k6/results/`
(git-ignored).

## Checks before deploying

`bash ../scripts/ci.sh` runs everything Jenkins runs:
- a secret scan (gitleaks)
- ruff, bandit and pip-audit on the server
- the server tests
- the app's lint, tests, build and npm audit

See `jenkins/README.md` for the pipeline.

## Server settings for more users

- `WEB_CONCURRENCY`: worker processes (1 when not set; 2–3 on a paid 1–2 CPU instance).
- `DB_POOL_SIZE` + `DB_MAX_OVERFLOW` (10 + 10): database connections per worker. Keep
  `workers × (pool + overflow)` under the database's limit.
- `SENTRY_DSN` / `SENTRY_ENVIRONMENT`: error tracking. It is off without a DSN, and sends no
  cookies or emails.
- Sign-in and reset limits are kept in the database (`auth_attempts`), so every worker shares
  them.
- Every API request logs one JSON line (`id`, `method`, `path`, `status`, `ms`), and the id is
  in the `X-Request-ID` answer header.

## Backups

```bash
BACKUP_DATABASE_URL="<Neon direct address>" bash ../scripts/backup-db.sh   # → backups/db/*.dump (git-ignored)
bash ../scripts/restore-drill.sh                                         # proves the newest backup restores
```

Use Neon's **direct** address (Connect → connection pooling off), pasted only for the command.
The restore drill puts the backup into a temporary PostgreSQL 18 in Docker. It checks the
tables and the server's readiness, prints how long it took, and touches nothing on Neon.
Recordings in B2 keep only their latest version, by choice.

## How sign-in works

- Passwords are stored only as argon2 hashes. At most two are worked out at the same moment
  (each takes about 64 MB of memory; the free server has 512 MB), and the database connection is
  given back while hashing.
- Signing in creates a random session key in an `httpOnly`, `Secure`, `SameSite=Lax` cookie
  (path `/api`); the database stores only its SHA-256 hash, so signing out ends it for good.
  Sessions last 30 days.
- Every change (POST/PUT/PATCH/DELETE) must carry `X-Requested-With: fetch`, which other websites
  cannot add (CORS is not enabled), so they cannot act for a signed-in user.
- 10 failed sign-ins per email (or per address) in 15 minutes → wait.
- The frontend and the API share one address: Netlify forwards `/api/*` to Render
  (see `netlify.toml`).

## Deploy (free plans)

1. **Neon** (database): create a project, copy the connection string
   (`postgresql://…?sslmode=require`, the "pooled" one).
2. **Render** (server): New → Blueprint → this repository. It reads `render.yaml`; paste the Neon
   string as `DATABASE_URL`. Note the address it gives (e.g.
   `https://melantha-guitar-api.onrender.com`).
3. If that address differs, update the `/api/*` redirect in `netlify.toml`, then push.
4. Create the admin account from your computer with the Neon string (see "Admin accounts").

The free server sleeps after 15 minutes without visitors and takes about a minute to wake; the
app shows "Waking up the server…" meanwhile. Moving to Render's paid plan later is a setting change.
