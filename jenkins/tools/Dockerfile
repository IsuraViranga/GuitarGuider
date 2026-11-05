# Tools for the deploy and smoke-test steps (Jenkinsfile): Node 22 (build the app, Netlify CLI),
# curl and jq (Render's API), git.
FROM node:22-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends jq \
 && rm -rf /var/lib/apt/lists/*
