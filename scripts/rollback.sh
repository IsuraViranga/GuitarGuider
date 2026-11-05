#!/usr/bin/env bash
# Rollback: puts back the version that worked before, on Render and Netlify. Jenkins offers it when
# the checks after a production deploy fail; it can also be run by hand with the same keys:
#
#   bash scripts/rollback.sh
#
# Environment: RENDER_API_KEY, RENDER_SERVICE_ID, NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID.
# The database is not rolled back: table changes are always backward compatible (added first,
# removed only in a later release), so the previous version works with the current tables.
set -euo pipefail
: "${RENDER_API_KEY:?}" "${RENDER_SERVICE_ID:?}" "${NETLIFY_AUTH_TOKEN:?}" "${NETLIFY_SITE_ID:?}"
RENDER=https://api.render.com/v1
render() { curl -fsS -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" "$@"; }

echo "== API (Render): back to the previous live deploy"
previous=$(render "$RENDER/services/$RENDER_SERVICE_ID/deploys?limit=20" \
  | jq -r '[.[] | .deploy | select(.status == "live" or .status == "deactivated")] | .[1].id // empty')
[ -n "$previous" ] || { echo "No earlier deploy found on Render." >&2; exit 1; }
render -X POST -H "Content-Type: application/json" -d "{\"deployId\": \"$previous\"}" "$RENDER/services/$RENDER_SERVICE_ID/rollback" | jq -r '"Render rollback started: " + .id'

echo "== Website (Netlify): back to the previous published deploy"
curl -fsS -X POST -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" "https://api.netlify.com/api/v1/sites/$NETLIFY_SITE_ID/rollback" >/dev/null
echo "Netlify rollback done. Check the site, then find the cause before deploying again."
