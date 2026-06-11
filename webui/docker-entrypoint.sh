#!/bin/sh
set -e

# All origin / feature flags are env-injected at container start so the
# same image works in dev / staging / prod. Defaults match local dev.
API_ORIGIN="${API_ORIGIN:-http://localhost:8888}"
VITE_BILLING_ENABLED="${VITE_BILLING_ENABLED:-false}"
VITE_MINI_APP_ORIGIN="${VITE_MINI_APP_ORIGIN:-http://localhost:5001}"
VITE_HOST_ORIGIN="${VITE_HOST_ORIGIN:-http://localhost:3000}"

# Generate config.js once, copy into both dist dirs. Each bundle's
# index.html loads /config.js before its own main.tsx, so the values
# are on window.__APP_CONFIG__ by the time module code runs.
sed -e "s|\${API_ORIGIN}|${API_ORIGIN}|g" \
    -e "s|\${VITE_BILLING_ENABLED}|${VITE_BILLING_ENABLED}|g" \
    -e "s|\${VITE_MINI_APP_ORIGIN}|${VITE_MINI_APP_ORIGIN}|g" \
    -e "s|\${VITE_HOST_ORIGIN}|${VITE_HOST_ORIGIN}|g" \
    /app/config.template.js > /app/dist/config.js

cp /app/dist/config.js /app/dist-mini-app/config.js

# Mini-app iframe runtime — background. If it crashes the container
# keeps serving the host (degraded: mini-app notes won't render but
# everything else works). If the host dies the container exits and
# Docker's restart policy handles it.
npx vite preview \
    --outDir /app/dist-mini-app \
    --host 0.0.0.0 \
    --port 5001 \
    --strictPort &

# Host bundle — foreground.
exec npx vite preview \
    --outDir /app/dist \
    --host 0.0.0.0 \
    --port 80 \
    --strictPort
