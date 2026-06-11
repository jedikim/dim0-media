// Separate Vite config for the mini-app iframe runtime (see
// mini-app-archi.md §6). The runtime lives at a different origin
// (different port in dev, different subdomain in prod) so the browser
// treats it as cross-origin from the host bundle — that's the
// load-bearing security primitive.
//
// In dev: two Vite servers, the host on $APP_PORT and the runtime on
// $MINI_APP_PORT, both spun up by separate `npm run` scripts.
// In prod: this config's build output is deployed under
// $VITE_MINI_APP_ORIGIN.

import path from "path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"


// CSP is intentionally not injected via index.html meta-tag (see the
// long comment in mini-app-runtime/index.html). Phase 4 hardening
// will move it to HTTP response headers from the asset host.


export default defineConfig({
  root: path.resolve(__dirname, "mini-app-runtime"),
  // Isolate the dep-optimize cache from the host's Vite server.
  // Otherwise both servers race on webui/node_modules/.vite/deps/ —
  // each one's startup invalidates the other's pre-bundled deps and
  // the browser gets 504 "Outdated Optimize Dep" until you Ctrl+C
  // both and restart in lockstep. With a dedicated dir this is a
  // non-issue regardless of order or timing.
  cacheDir: path.resolve(__dirname, "node_modules/.vite-mini-app"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The runtime will pull a curated subset of host components into
      // its bundle (Card, Button, Chart, ...). They share source via
      // the same `@/...` alias; tree-shaking + a small SCOPE registry
      // keeps the bundle lean.
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.MINI_APP_PORT) || 5174,
    strictPort: true,
    // The iframe loads with sandbox="allow-scripts" (no allow-same-origin)
    // → it has an opaque "null" origin → every module script it requests
    // from us (@vite/client, @react-refresh, main.tsx, sucrase, the
    // runtime CSS) is treated as cross-origin by the browser. Without
    // explicit CORS the script fetches fail and the iframe stays empty.
    //
    // Echoing `origin: "*"` is safe in dev: the assets served here are
    // public dev-runtime modules. In prod the static asset host
    // (mini-app.<your-domain>) must send the same header — Phase 4
    // hardening covers that side.
    cors: { origin: "*" },
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.MINI_APP_PORT) || 5174,
    strictPort: true,
    cors: { origin: "*" },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-mini-app"),
    emptyOutDir: true,
  },
})
