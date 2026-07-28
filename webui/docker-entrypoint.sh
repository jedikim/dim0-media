#!/bin/sh
set -e

# All origin / feature flags are env-injected at container start so the
# same image works in dev / staging / prod. Defaults match local dev.
API_ORIGIN="${API_ORIGIN:-http://localhost:8888}"
VITE_BILLING_ENABLED="${VITE_BILLING_ENABLED:-false}"
# Empty by default → single-frontend mini-app mode: the runtime loads from
# `/mini-app` same-origin in an OPAQUE (allow-scripts, NO allow-same-origin)
# iframe (see mini-app/mount.tsx). Set to a real subdomain ONLY for opt-in
# cross-origin mode. A non-empty value equal to the host origin is unsafe and
# trips the mount's guard — which is what a stale localhost:5001 default did.
VITE_MINI_APP_ORIGIN="${VITE_MINI_APP_ORIGIN:-}"
VITE_HOST_ORIGIN="${VITE_HOST_ORIGIN:-http://localhost:3000}"

# Generate the runtime config into the single frontend bundle. index.html loads
# /config.js before main.tsx, so the values are on window.__APP_CONFIG__ by the
# time module code runs.
#
# Single-frontend build: the mini-app is bundled INTO dist/ (dist/mini-app,
# outDir public/mini-app), not a separate dist-mini-app served cross-origin on
# :5001. Drop a config.js next to it too when present, for a direct load of the
# mini-app entry. (Pre-cd59bef this copied into a dist-mini-app dir that no
# longer exists — the failing copy crashed the container under `set -e`.)
sed -e "s|\${API_ORIGIN}|${API_ORIGIN}|g" \
    -e "s|\${VITE_BILLING_ENABLED}|${VITE_BILLING_ENABLED}|g" \
    -e "s|\${VITE_MINI_APP_ORIGIN}|${VITE_MINI_APP_ORIGIN}|g" \
    -e "s|\${VITE_HOST_ORIGIN}|${VITE_HOST_ORIGIN}|g" \
    /app/config.template.js > /app/dist/config.js

[ -d /app/dist/mini-app ] && cp /app/dist/config.js /app/dist/mini-app/config.js

# Serve the single frontend. Also served on :5001 so the legacy mini-app-origin
# port mapping still resolves to the same bundle (harmless) rather than a dead
# port. Background; a failure there doesn't take down the host on :80.
npx vite preview \
    --outDir /app/dist \
    --host 0.0.0.0 \
    --port 5001 \
    --strictPort &

# Host — foreground.
exec npx vite preview \
    --outDir /app/dist \
    --host 0.0.0.0 \
    --port 80 \
    --strictPort
