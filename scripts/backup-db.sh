#!/usr/bin/env bash
# Copies the whole database (all tables and data) to a file on this computer, with pg_dump from
# Docker (the same PostgreSQL version as Neon, 18: an older pg_dump refuses a newer server).
#
#   BACKUP_DATABASE_URL="postgresql://…" bash scripts/backup-db.sh
#
# Use Neon's DIRECT address (Neon → Connect → turn "Connection pooling" off: the host has no
# "-pooler"); pg_dump needs one steady connection. Never write the address into a file in the
# repository: paste it in the terminal for this command only.
#
# Files: backups/db/melantha-<date>.dump (git-ignored); the newest 8 are kept. Check a backup with
# scripts/restore-drill.sh. The recordings (Backblaze B2) are not part of this backup.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL to the database address (Neon, direct, not pooled).}"
case "$BACKUP_DATABASE_URL" in
  *-pooler.*) echo "This is Neon's pooled address. Use the direct one (no \"-pooler\" in the host)." >&2; exit 2 ;;
esac

ROOT=$(cd "$(dirname "$0")/.." && pwd)
KEEP=${KEEP:-8}
FOLDER="$ROOT/backups/db"
mkdir -p "$FOLDER"
NAME="melantha-$(date +%Y%m%d-%H%M%S).dump"
HOST_FOLDER=$(cd "$FOLDER" && (pwd -W 2>/dev/null || pwd))

echo "Copying the database to backups/db/$NAME …"
MSYS_NO_PATHCONV=1 docker run --rm -e DATABASE_URL="$BACKUP_DATABASE_URL" -v "$HOST_FOLDER:/backup" postgres:18 \
  sh -c 'pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" --file="/backup/'"$NAME"'"'

SIZE=$(du -h "$FOLDER/$NAME" | cut -f1)
echo "Saved: backups/db/$NAME ($SIZE)"

# Keep only the newest backups.
ls -1t "$FOLDER"/melantha-*.dump | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "Removing old backup $(basename "$old")"
  rm -f "$old"
done
