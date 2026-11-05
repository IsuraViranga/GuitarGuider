#!/usr/bin/env bash
# Deploys one exact commit: the API on Render first (it waits until the new server is live), then
# the website on Netlify. Jenkins runs it (Jenkinsfile), with keys from Jenkins Credentials:
#
#   bash scripts/deploy.sh <staging|production>
#
# Environment (never written in the repository):
#   GIT_COMMIT          the commit to deploy (Jenkins sets it)
#   RENDER_API_KEY      Render → Account settings → API keys
#   RENDER_SERVICE_ID   the Render service of this environment (srv-…)
#   NETLIFY_AUTH_TOKEN  Netlify → User settings → Applications → Personal access tokens
#   NETLIFY_SITE_ID     the Netlify site of this environment (Site configuration → Site ID)
#   API_URL             the API address of this environment, e.g. https://….onrender.com: the
#                       website forwards /api/* there (staging; production uses netlify.toml)
#   VITE_SENTRY_DSN     optional: error tracking in the app
#
# Order matters: the server changes are backward compatible, so the new API works with the old
# website for the minute between the two steps.
set -euo pipefail

ENVIRONMENT=${1:?"staging or production"}
case "$ENVIRONMENT" in staging|production) ;; *) echo "staging or production" >&2; exit 2 ;; esac
: "${GIT_COMMIT:?}" "${RENDER_API_KEY:?}" "${RENDER_SERVICE_ID:?}" "${NETLIFY_AUTH_TOKEN:?}" "${NETLIFY_SITE_ID:?}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NETLIFY_CLI=netlify-cli@27.13.0
RENDER=https://api.render.com/v1

render() { curl -fsS -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" "$@"; }

echo "== API (Render, $ENVIRONMENT): deploying commit ${GIT_COMMIT:0:7}"
deploy=$(render -X POST -H "Content-Type: application/json" -d "{\"commitId\": \"$GIT_COMMIT\"}" "$RENDER/services/$RENDER_SERVICE_ID/deploys" || true)
deploy_id=$(printf '%s' "$deploy" | jq -r '.id // empty' 2>/dev/null || true)
if [ -z "$deploy_id" ]; then
  # Queued behind another deploy (no answer body): find the newest deploy of this commit.
  sleep 10
  deploy_id=$(render "$RENDER/services/$RENDER_SERVICE_ID/deploys?limit=10" | jq -r --arg c "$GIT_COMMIT" '[.[] | .deploy | select(.commit.id == $c)][0].id // empty')
fi
[ -n "$deploy_id" ] || { echo "Render did not start a deploy." >&2; exit 1; }
echo "Render deploy $deploy_id started; waiting until it is live (up to 20 minutes) …"
for _ in $(seq 1 80); do
  status=$(render "$RENDER/services/$RENDER_SERVICE_ID/deploys/$deploy_id" | jq -r '.status')
  case "$status" in
    live) echo "API is live."; break ;;
    build_failed|update_failed|pre_deploy_failed|canceled|deactivated)
      echo "Render deploy ended as \"$status\". The previous version keeps running; see Render → Events/Logs." >&2; exit 1 ;;
    *) printf '  %s\n' "$status"; sleep 15 ;;
  esac
done
[ "$status" = live ] || { echo "The Render deploy did not finish within 20 minutes." >&2; exit 1; }
echo "$deploy_id" > "$ROOT/.render-deploy-id"  # for the report (and a rollback, if needed)

echo "== Website (Netlify, $ENVIRONMENT): building and publishing"
cd "$ROOT/frontend"
npm ci --no-audit --no-fund
VITE_SENTRY_ENVIRONMENT="$ENVIRONMENT" npm run build
FUNCTIONS=()
if [ "$ENVIRONMENT" = staging ]; then
  : "${API_URL:?Set API_URL to the staging API address}"
  # Rules in _redirects come before netlify.toml's: staging's /api/* goes to the staging API.
  printf '/api/*  %s/api/:splat  200!\n/*  /index.html  200\n' "${API_URL%/}" > dist/_redirects
else
  # Production keeps netlify.toml's rules and the 5-minute health check (free Render plan).
  FUNCTIONS=(--functions netlify/functions)
fi
npx --yes "$NETLIFY_CLI" deploy --dir dist "${FUNCTIONS[@]}" --prod --site "$NETLIFY_SITE_ID" --auth "$NETLIFY_AUTH_TOKEN" \
  --message "${ENVIRONMENT}: ${GIT_COMMIT:0:7} (Jenkins)"
echo "Website is live."
