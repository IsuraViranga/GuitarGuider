#!/usr/bin/env bash
# Restore drill: proves a backup can really be restored. Puts the newest backup (or the file given)
# into a fresh, temporary PostgreSQL 18 in Docker, checks the tables and counts, and runs the
# server's own readiness check against it. Nothing on Neon is touched.
#
#   bash scripts/restore-drill.sh [backups/db/melantha-<date>.dump]
#
# It prints how long the restore took (part of the "back within 4 hours" goal) and removes the
# temporary database at the end.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
FILE=${1:-$(ls -1t "$ROOT"/backups/db/melantha-*.dump 2>/dev/null | head -1)}
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "No backup found. Make one first: scripts/backup-db.sh" >&2; exit 2; }
FOLDER=$(cd "$(dirname "$FILE")" && (pwd -W 2>/dev/null || pwd))
NAME=$(basename "$FILE")
CONTAINER=melantha-restore-drill
PORT=${PORT:-55439}

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

started=$(date +%s)
echo "Starting a temporary PostgreSQL 18 …"
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restored \
  -p "$PORT:5432" -v "$FOLDER:/backup:ro" postgres:18 >/dev/null
until docker exec "$CONTAINER" pg_isready -U postgres -d restored >/dev/null 2>&1; do sleep 1; done

echo "Restoring $NAME …"
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" pg_restore --no-owner --no-acl --exit-on-error -U postgres -d restored "/backup/$NAME"

echo "What is in it:"
docker exec "$CONTAINER" psql -U postgres -d restored -At -F ' | ' -c "
  select 'table version (migration)', version_num from alembic_version
  union all select 'accounts', count(*)::text from users
  union all select 'songs', count(*)::text from songs
  union all select 'saved practices', count(*)::text from practice_saves
  union all select 'guitar setups', count(*)::text from string_setups
  union all select 'recorded guitars', count(*)::text from dataset_guitars
  union all select 'recordings (details; audio is in B2)', count(*)::text from dataset_samples"

echo "The server's readiness check against the restored copy:"
cd "$ROOT/backend"
PY=python
[ -x .venv/Scripts/python.exe ] && PY=.venv/Scripts/python.exe
[ -x .venv/bin/python ] && PY=.venv/bin/python
DATABASE_URL="postgresql://postgres@localhost:$PORT/restored" SENTRY_DSN="" "$PY" -c "
from fastapi.testclient import TestClient
from app.main import app
r = TestClient(app).get('/api/health/ready')
print(r.status_code, r.json())
raise SystemExit(0 if r.status_code == 200 else 1)"

echo "Restore drill passed in $(( $(date +%s) - started )) s. (The temporary database is removed now.)"
