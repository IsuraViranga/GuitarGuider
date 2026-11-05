#!/usr/bin/env bash
# Smoke test after a deploy: the few things that must work, checked from outside like a visitor.
#
#   bash scripts/smoke.sh <api-address> <website-address>
#   e.g. bash scripts/smoke.sh https://melantha-guitar-api.onrender.com https://melantha-guitar-academy.netlify.app
#
# Read-only: it creates nothing, so it is safe on production. Exit code 0 = all good.
set -uo pipefail

API=${1:?"API address"}
SITE=${2:?"website address"}
API=${API%/}
SITE=${SITE%/}
failed=0

check() {  # name, url, expected text in the answer
  local name=$1 url=$2 expect=$3 body code
  for attempt in 1 2 3 4 5 6; do
    body=$(curl -sS --max-time 60 -w '\n%{http_code}' "$url" 2>/dev/null) || body=$'\n000'
    code=${body##*$'\n'}
    body=${body%$'\n'*}
    if [ "$code" = 200 ] && printf '%s' "$body" | grep -q -- "$expect"; then
      echo "ok    $name"
      return 0
    fi
    sleep 10  # a server just deployed (or waking up) may need a moment
  done
  echo "FAIL  $name ($url answered $code)"
  failed=1
}

check "API is running"                          "$API/api/health/live"         '"alive"'
check "API is ready (database and its tables)"  "$API/api/health/ready"        '"ready"'
check "Global songs load"                       "$API/api/songs?scope=global"  '"songs"'
check "Website loads"                           "$SITE/"                       'id="root"'
check "Website forwards /api to the API"        "$SITE/api/health/live"        '"alive"'
check "A song page loads (app routes)"          "$SITE/songs"                  'id="root"'

if [ "$failed" = 0 ]; then echo "Smoke test passed."; else echo "Smoke test FAILED."; fi
exit "$failed"
