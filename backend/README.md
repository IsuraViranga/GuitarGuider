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

## Load test

`loadtest/load_test.py` makes many pretend students use the API at once (sign up, songs, a song,
save practice, My progress) and prints the time per request and any errors:

```bash
.venv/Scripts/python loadtest/load_test.py --users 500
```

It refuses a server that is not on this computer unless `--allow-remote` is given (it creates
real accounts). Results (October 2026) are in `docs/ARCHITECTURE.md` (8n).

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
