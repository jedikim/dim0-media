# Mini-app — production deployment runbook

> Practical checklist for shipping the mini-app iframe runtime to a new
> environment (staging / prod). Companion to [mini-app-archi.md](mini-app-archi.md)
> which covers the *why*; this doc covers the *what to do, in order*.

## TL;DR

The webui Docker image already builds **both** bundles (host + iframe
runtime) and serves them on two ports inside the container. Caddy
routes two subdomains to those two ports. Per-environment URLs flow
through `docker-entrypoint.sh` → `config.js` → both bundles. **One
image, one container, two subdomains.**

## What's served where

| Subdomain                     | Container port | Bundle               | Source dir                     |
|---|---|---|---|
| `dim0.net`                    | `:80`          | Host app             | `webui/dist/`                  |
| `mini-app.dim0.net`           | `:5001`        | Iframe runtime       | `webui/dist-mini-app/`         |

Cross-origin separation between the two subdomains is the **load-bearing
security primitive**. Don't collapse them onto the same host — the
sandbox model breaks. See [mini-app-archi.md §5](mini-app-archi.md#5-origin-strategy).

---

## 1. Env vars (per environment)

Two new vars on top of the existing API/billing ones. Set them in the
`.env` (or equivalent secret store) used by the target environment.

```bash
# Public origins as the BROWSER sees them. https in prod.
VITE_HOST_ORIGIN=https://dim0.net
VITE_MINI_APP_ORIGIN=https://mini-app.dim0.net

# Container-internal port for the iframe runtime. Caddy reverse_proxies
# to this. Defaults vary per docker-compose profile (see compose YAML
# for the dev port — 5181 for dev, 5184 for prod). Override only if
# you need to.
# MINI_APP_PORT=5001
```

Existing vars stay as they were — `API_ORIGIN`, `VITE_BILLING_ENABLED`,
`APP_PORT`, etc.

### How the values get into the bundles

`docker-entrypoint.sh` `sed`-substitutes them into `config.template.js`
at container start, producing:

```js
window.__APP_CONFIG__ = {
  apiBase: "https://api.dim0.net",
  miniAppOrigin: "https://mini-app.dim0.net",
  hostOrigin: "https://dim0.net",
  ...
}
```

That `config.js` is copied to both `dist/` and `dist-mini-app/`. Each
bundle's `index.html` loads `/config.js` before its own `main.tsx`.

**The same image deploys to dev / staging / prod.** Only the env vars
change.

---

## 2. Caddy configuration

Add **one block** to your existing Caddyfile alongside `dim0.net { ... }`.
Caddy provisions the Let's Encrypt cert automatically on first request.

```caddyfile
mini-app.dim0.net {
    reverse_proxy webui:5001
    encode zstd gzip

    # Required: the iframe loads with sandbox="allow-scripts" +
    # allow-same-origin → its origin is mini-app.dim0.net, cross-origin
    # to the host at dim0.net. Without this, the iframe can't even
    # fetch its own scripts (browser blocks as CORS).
    header Access-Control-Allow-Origin "*"

    # Production CSP — strict. 'self' is reliable here because Caddy
    # serves from a real origin (unlike the meta-tag CSP we tried
    # earlier which failed inside the null-origin sandbox).
    #
    # connect-src 'none' = agent-authored widget code cannot fetch
    # anywhere. The only thing the widget can talk to is the host via
    # its postMessage RPC.
    header Content-Security-Policy "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'none'; frame-ancestors https://dim0.net"

    # Defense-in-depth: the only site that may embed this runtime is
    # the host app. Useful guard against the runtime URL leaking and
    # being framed by someone else.
    header X-Frame-Options "ALLOW-FROM https://dim0.net"
}
```

After editing, reload Caddy:

```bash
caddy reload --config /etc/caddy/Caddyfile
# or via docker:
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
```

---

## 3. DNS

Add **one record** at your registrar / DNS provider for `dim0.net`:

```
mini-app.dim0.net    CNAME    dim0.net
# or, if you don't want CNAME-at-apex resolution:
mini-app.dim0.net    A        <your server's public IP>
```

Verify before reloading Caddy:

```bash
dig mini-app.dim0.net +short
# should print the same IP/CNAME as `dig dim0.net +short`
```

---

## 4. Deploy procedure (per environment)

### Local / dev (from source)

```bash
cd /path/to/cooldown

# 1. Confirm .env has the four mini-app vars
grep -E "MINI_APP_PORT|VITE_MINI_APP_ORIGIN|VITE_HOST_ORIGIN" .env

# 2. Standard make recipe — Docker image builds both bundles
make build-up PROFILE=dev
```

The webui container is now serving both bundles on the ports declared
in `build/docker-compose.yml` for that profile.

### Staging / prod (from prebuilt image)

```bash
cd /path/to/cooldown

# 1. Confirm prod .env has the override values
#    VITE_MINI_APP_ORIGIN=https://mini-app.dim0.net
#    VITE_HOST_ORIGIN=https://dim0.net

# 2. Pull + start
make run    # or whatever your existing prod recipe is
```

`docker-compose.images.yml` runs the published `dim0-webui` image with
the prod env vars wired in. The image is identical to dev's; only
config differs.

---

## 5. Verification after deploy

Run these from any machine that can reach the new subdomain:

```bash
# 1. DNS resolves
dig mini-app.dim0.net +short
# expected: your server IP

# 2. HTTPS is up + cert is valid (Caddy auto-provisioned)
curl -sI https://mini-app.dim0.net/index.html | head -1
# expected: HTTP/2 200

# 3. CORS header is present
curl -sI https://mini-app.dim0.net/index.html | grep -i access-control-allow
# expected: access-control-allow-origin: *

# 4. CSP header is present
curl -sI https://mini-app.dim0.net/index.html | grep -i content-security-policy
# expected: a long CSP string starting with default-src 'none';

# 5. config.js has the right values (not template placeholders)
curl -s https://mini-app.dim0.net/config.js
# expected: window.__APP_CONFIG__ with real URLs, no ${VAR} left
```

Then in the host app at `https://dim0.net`:

1. Sign in, open a board
2. Ask the agent to create a counter mini-app
3. Counter should appear on the canvas, click `+`, value increments
4. Refresh — value persists (proves backend state endpoint works
   cross-origin)
5. Hard refresh — iframe still loads (proves CORS + CSP didn't break
   anything)

If any verify step fails, jump to troubleshooting below.

---

## 6. Troubleshooting

### Iframe is blank, browser console says "Failed to load resource: 504"

Vite dep-optimizer cache went stale (rare in prod since the container
is fresh on each deploy, but possible after a `docker exec` rebuild).
Fix:

```bash
docker exec <webui-container> rm -rf /app/node_modules/.vite /app/node_modules/.vite-mini-app
docker restart <webui-container>
```

### Iframe is blank, console says "CORS policy: No 'Access-Control-Allow-Origin' header"

Caddy isn't sending the CORS header. Either:
- The Caddyfile block above isn't loaded (`caddy reload` again)
- The block is for the wrong subdomain (typo in `mini-app.dim0.net`)
- A different reverse-proxy upstream is winning (check Caddy's
  effective config: `caddy adapt --config /etc/caddy/Caddyfile`)

### Iframe is blank, console says "Refused to connect to ws://..."

CSP `connect-src 'none'` is correct for prod. If you see this in
dev-via-docker, it means Vite's HMR WebSocket is being blocked. Either
disable HMR in the prod-style image or accept the lost HMR — the runtime
still loads and renders.

### `docker logs <webui-container>` shows "VITE_HOST_ORIGIN not set"

`docker-entrypoint.sh` didn't substitute properly. Check that:
- The env vars are actually passed to the container
  (`docker exec <c> env | grep VITE_`)
- `config.js` exists in both dist dirs:
  `docker exec <c> ls /app/dist/config.js /app/dist-mini-app/config.js`
- `config.js` contains real URLs, not placeholder strings:
  `docker exec <c> cat /app/dist/config.js`

### Cert isn't provisioning

Caddy needs to be able to bind port 80 for the HTTP-01 challenge.
Common causes:
- A previous service is bound to :80 — `lsof -i :80` on the host
- Firewall blocks Let's Encrypt's request — check
  `caddy logs` and look for ACME errors
- DNS hasn't propagated yet — wait a few minutes, retry

### Two ports show in `docker ps` but Caddy can't reach `:5001`

Check that Caddy is on the same Docker network as the webui container.
If Caddy runs on the host (not in Docker), the compose file needs to
**publish** port 5001 (not just `expose`). The current YAML publishes
both, which is fine.

---

## 7. Rollback

The runtime is wired such that **disabling mini-apps** doesn't break
the rest of the app:

```bash
# Stop the runtime preview inside the container (host preview keeps running):
docker exec <webui-container> pkill -f "vite preview.*dist-mini-app"

# Effect: existing mini-app notes render the canvas card chrome but
# the iframe fails to load. Host app, agent chat, all other note types
# continue to work normally.
```

To rollback to a pre-mini-app deploy entirely, redeploy a prior tag
that doesn't have the second port wired up. The mini_app_state table
in postgres is additive and safe to leave (or `DROP TABLE` if you really
want a clean slate).

---

## 8. Files that matter

If you're trying to remember "where is this configured":

| Thing | File |
|---|---|
| What env vars flow to the container | `webui/docker-entrypoint.sh` |
| Where `window.__APP_CONFIG__` shape is declared | `webui/config.template.js` + `webui/src/config/api.ts` |
| Which port the runtime listens on inside the container | `webui/Dockerfile` `EXPOSE` + entrypoint `vite preview --port` |
| Which port is published to the host | `build/docker-compose.yml` / `docker-compose.images.yml` |
| How the host bundle finds the runtime URL | `webui/src/features/mini-app/mount.tsx` `RUNTIME_ORIGIN` |
| How the runtime finds the host URL | `webui/mini-app-runtime/main.tsx` `HOST_ORIGIN` |
| CORS / CSP / cert | Your Caddyfile (outside this repo) |
| DNS | Your registrar (outside this repo) |

---

## 9. Reference

- Architecture: [mini-app-archi.md](mini-app-archi.md)
- Backend persistence: `backend/topix/api/router/mini_app_state.py`
- Agent skill prompt: `backend/topix/prompts/widget/learn_generate_mini_app.jinja`
- Runtime entry: `webui/mini-app-runtime/main.tsx`
- Host mount: `webui/src/features/mini-app/mount.tsx`
- Canvas integration: `webui/src/features/board/harness/node-types/mini-app/`
