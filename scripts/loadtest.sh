#!/usr/bin/env bash
# Runs the k6 load test (backend/loadtest/k6/journeys.js) with k6 in Docker: nothing to install.
#
#   bash scripts/loadtest.sh <profile> <api-address> [recordings]
#
#   profile:     smoke (5 students, 1 min), load50, load100, load250, target500, spike (50→500→50),
#                soak (SOAK_VUS students, default 150, for SOAK_TIME, default 60m)
#   api-address: the API server, e.g. https://<staging-api>.onrender.com, or http://localhost:8000
#   recordings:  "yes" to include recording uploads and playback (the server must have storage)
#
# Run it from a computer that is not the server or Jenkins. It creates accounts and data: use
# staging. The live site is refused unless ALLOW_PRODUCTION=yes. The summary is also saved in
# backend/loadtest/k6/results/ (git-ignored).
set -euo pipefail

PROFILE=${1:?"profile: smoke, load50, load100, load250, target500, spike or soak"}
BASE_URL=${2:?"the API address, e.g. https://<staging-api>.onrender.com"}
RECORDINGS=${3:-no}
K6_IMAGE=grafana/k6:2.2.0
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# Inside Docker, "localhost" is the container itself: the PC is host.docker.internal.
DOCKER_URL=${BASE_URL/localhost/host.docker.internal}
DOCKER_URL=${DOCKER_URL/127.0.0.1/host.docker.internal}
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$ROOT/backend/loadtest/k6/results"
SCRIPTS=$(cd "$ROOT/backend/loadtest/k6" && (pwd -W 2>/dev/null || pwd))

MSYS_NO_PATHCONV=1 docker run --rm -i \
  -v "$SCRIPTS:/k6" \
  -e PROFILE="$PROFILE" -e BASE_URL="$DOCKER_URL" -e RECORDINGS="$RECORDINGS" -e RUN_ID="$STAMP" \
  -e ALLOW_PRODUCTION="${ALLOW_PRODUCTION:-no}" -e SOAK_VUS="${SOAK_VUS:-150}" -e SOAK_TIME="${SOAK_TIME:-60m}" \
  "$K6_IMAGE" run --summary-export "/k6/results/$PROFILE-$STAMP.json" /k6/journeys.js
