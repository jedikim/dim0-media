# ADR-DESKTOP-002: Desktop networking — BYOK direct via plugin-http; managed + synced via a build-time server URL

**Status:** Accepted · 2026-08-01 (amended 2026-08-04: in-app server-URL override removed — baked `VITE_API_URL` only)
**Applies to:** `webui/src/features/agent/engine/services/desktop-*.ts`, `webui/src/features/agent/engine/byok-client.ts`, `webui/src/features/desktop/**`, `webui/src/config/api.ts`, `webui/src-tauri/capabilities/default.json`

## Decision
On the Tauri build, the two request paths split by mode (`resolveService` is
unchanged — only the transport branches on `isTauri()`):

- **BYOK → direct.** LLM / search / parse in `byok` mode MUST reach the provider
  **directly** via `@tauri-apps/plugin-http` (CORS-free), NOT our `/ai/*` proxy: the
  OpenAI SDK gets the Tauri `fetch` (`byok-client.ts`), and search/parse use
  `desktop-search.ts` / `desktop-parse.ts` returning the `/ai/*` reply shapes. Every
  provider host MUST be listed in the `http` capability allow-list.
- **Managed → remote.** `managed` calls stay on the remote server, driven by
  `API_URL`, which is **baked in at build** via `VITE_API_URL` (the same env var
  the web frontend uses — so a distributor ships pointing at their server and users
  just sign in). There is **no in-app override**: the server is fixed at build time
  (`getEffectiveApiBase`). The value is normalized to an **origin root** — any path
  is dropped, since the app addresses the backend with absolute paths.
- **Local/offline = signed out.** The front door makes zero backend calls while
  signed out, so BYOK-only local use contacts no server regardless of whether one
  is configured. The sign-in entry point is always shown, but sign-in only
  succeeds once `VITE_API_URL` points at a real server.

## Why
The desktop webview enforces CORS like a browser, so BYOK provider calls need a
non-CORS path — `plugin-http` provides it — and going through our proxy would
require our server (defeating offline) and can't relay the user's LLM key anyway.
A shipped desktop app can't hold *our* secret keys, so **managed** is served only
by the remote server, gated on sign-in. One `API_URL` already drives REST, collab
WS (`wsBaseFromApiUrl`), and managed `/ai/*`, so a single setting lights up the
whole remote path — no per-subsystem wiring. The origin-root normalization exists
because the app addresses the backend with absolute paths, so any path in
`VITE_API_URL` would be dropped anyway.

## Consequences
- Offline BYOK agent works with the user's keys: LLM, all four search engines
  (linkup/tavily/perplexity/exa), and PDF parse (Mistral OCR, base64 single-POST —
  same call the backend `MistralParser` makes). Unported engines fall back online.
- `fetch` + `code_interpreter` are managed-only by existing design → auto-`off`
  offline (no BYOK key slot / no local sandbox).
- Adding a BYOK provider = a thin client + its host in the capability allow-list.
- Baking `VITE_API_URL` into the desktop bundle requires the **final `vite build` to
  be dotenv-wrapped** (`webui/package.json` `build`); the web build doesn't need it
  (runtime `__APP_CONFIG__` injection wins), so it's easy to regress — the desktop
  app would then silently fall back to `localhost:8888`.
- Per-capability resolution + metering are unchanged — see [ADR-AGENT-003](./ADR-AGENT-003-service-resolution-and-metering.md).

## Rejected alternatives
- **Bundle the Python backend as a sidecar** — 100s of MB, per-OS, and there are no
  managed keys to reuse in a shipped app; only avoids rewriting ~4 thin HTTP calls.
- **A local Rust HTTP server for `/ai/*`** — more Rust than injecting a fetch; kept
  as a fallback only if plugin-http streaming disappoints.
- **An in-app server-URL override (settings/dialog)** — removed: the server is a
  build-time concern (`VITE_API_URL`), so a runtime picker added UI, a localStorage
  precedence, reload-and-clear-tokens plumbing, and a web-safety gate for no real
  gain. A distributor bakes the URL; there's nothing for an end user to change.

## Verify
`grep -rn "tauriFetch\|plugin-http" webui/src/features/agent/engine/services/desktop-http.ts` — BYOK routes through the CORS-free fetch.
`grep -n "getEffectiveApiBase\|VITE_API_URL" webui/src/features/desktop/desktop-config.ts` — API_URL comes only from the baked env var (no in-app override).
