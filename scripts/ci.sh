#!/usr/bin/env bash
# The checks every change must pass before it may go live. Jenkins runs exactly this script (see
# Jenkinsfile); run it yourself before pushing:
#
#   bash scripts/ci.sh            # everything
#   bash scripts/ci.sh backend    # or: frontend, secrets
#
# Needs:
#   - backend: Python 3.13 with backend/requirements-dev.txt (backend/.venv is used when present)
#     and a PostgreSQL database for the tests: TEST_DATABASE_URL, by default
#     postgresql://postgres@localhost:55432/guitar_test (its tables are emptied by the tests).
#   - frontend: Node 22.
#   - secrets: gitleaks, or Docker (the gitleaks image is used).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
GITLEAKS_IMAGE=zricethezav/gitleaks:v8.30.1

step() { printf '\n=== %s ===\n' "$*"; }

python_bin() {
  if [ -n "${PYTHON:-}" ]; then echo "$PYTHON"
  elif [ -x "$ROOT/backend/.venv/Scripts/python.exe" ]; then echo "$ROOT/backend/.venv/Scripts/python.exe"
  elif [ -x "$ROOT/backend/.venv/bin/python" ]; then echo "$ROOT/backend/.venv/bin/python"
  else echo python3
  fi
}

backend() {
  local py
  py=$(python_bin)
  cd "$ROOT/backend"
  step "Server: real mistakes in the code (ruff: syntax errors, undefined names, unused imports)"
  "$py" -m ruff check app tests alembic loadtest
  step "Server: risky code patterns (bandit, high severity)"
  "$py" -m bandit -q -r app -lll
  step "Server: packages with known security problems (pip-audit)"
  "$py" -m pip_audit -r requirements.txt --progress-spinner off
  step "Server: tests (real PostgreSQL)"
  "$py" -m pytest -q
}

frontend() {
  cd "$ROOT/frontend"
  if [ "${CI:-}" = "true" ] || [ ! -d node_modules ]; then
    step "App: install packages exactly as locked (npm ci)"
    npm ci --no-audit --no-fund
  fi
  step "App: lint (oxlint)"
  npm run lint
  step "App: unit tests (vitest)"
  if [ "${CI:-}" = "true" ]; then
    # Build machines are slower and run the server tests at the same time: more time per test.
    npm test -- --testTimeout=20000
  else
    npm test
  fi
  step "App: type check and build"
  npm run build
  step "App: packages with known security problems (npm audit, high and critical)"
  npm audit --omit=dev --audit-level=high
}

secrets() {
  step "Secrets: no keys or passwords in the code or its history (gitleaks)"
  cd "$ROOT"
  if command -v gitleaks >/dev/null 2>&1; then
    gitleaks git --redact --no-banner --config .gitleaks.toml .
  else
    # Git Bash on Windows: hand Docker a Windows path, unchanged.
    local here
    here=$(pwd -W 2>/dev/null || pwd)
    MSYS_NO_PATHCONV=1 docker run --rm -v "$here:/repo" "$GITLEAKS_IMAGE" git --redact --no-banner --config /repo/.gitleaks.toml /repo
  fi
}

case "${1:-all}" in
  backend) backend ;;
  frontend) frontend ;;
  secrets) secrets ;;
  all) secrets; backend; frontend ;;
  *) echo "Usage: bash scripts/ci.sh [all|backend|frontend|secrets]" >&2; exit 2 ;;
esac
step "All checks passed"
