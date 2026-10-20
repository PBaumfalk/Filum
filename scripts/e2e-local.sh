#!/bin/sh
# Baut Filum, startet eine frische Instanz auf 28080/28081 und führt die E2E-Tests aus.
set -e
cd "$(dirname "$0")/.."
DATA=$(mktemp -d)
npm run build >/dev/null
DATA_DIR=$DATA PUBLIC_PORT=28080 ADMIN_PORT=28081 APP_URL=http://localhost:28081 DEFAULT_DOMAIN=localhost:28080 \
  SETUP_CODE=424-242-424 LOG_LEVEL=warn node dist/server/main.js > "$DATA/server.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$DATA"' EXIT
for i in $(seq 1 40); do curl -sf http://localhost:28081/healthz >/dev/null && break; sleep 0.25; done
FILUM_URL=http://localhost:28081 FILUM_PUBLIC=http://localhost:28080 FILUM_SETUP_CODE=424-242-424 npx playwright test "$@"
