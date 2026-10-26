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

## How sign-in works

- Passwords are stored only as argon2 hashes.
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
