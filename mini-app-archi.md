![1781088342791](image/mini-app-archi/1781088342791.png)# Dim0 Mini-App — Architecture & Implementation Plan

> Status: design doc — not yet built. Supersedes the abandoned
> "widget DSL" effort (`feat/widget-dsl` branch). This doc captures
> *why* we're not shipping that DSL and *what* we are shipping
> instead: iframe-sandboxed React mini-apps with a sucrase compile
> pipeline and a curated component scope.

## 1. Why this doc exists

We tried to ship a hand-rolled YAML/JSON DSL for agent-authored
interactive widgets ("mini-apps"). It had:

- HTML-tag vocabulary + 5 keywords (`children`, `on`, `bind`, `if`, `for`)
- A custom expression evaluator (arithmetic, ternary, helpers, etc.)
- Two-tier behavior model (shared tier-1 vs widget-local tier-2 JS)
- Cross-language schema parity (Zod + Pydantic + skill prompt)
- Per-custom-element validation pipeline with CST-mapped line/col errors

It collapsed under its own weight. The recurring failures, in order
of severity:

1. **Agent reliability.** The agent kept producing widgets that were
   plausible but subtly wrong (`_index` vs `$index`, missing `len()`,
   `yAxis` as object vs list, plural vs singular). No agent prior on
   our bespoke grammar.
2. **Maintenance surface.** Every prop change touched four files
   (Zod schema, Pydantic mirror, skill prompt, translator) and the
   parity tests.
3. **Whack-a-mole validation.** Tightening rejected valid output,
   loosening let crashes back in. There was no stable equilibrium.
4. **Expressivity ceiling.** Algorithm visualizers (bubble sort,
   Dijkstra) needed agent-written JS — the tier-2 behavior escape
   hatch — which broke the security story for multi-user collab.

We are a multi-user collaborative app. A persisted widget is
**user-generated content** rendered in other users' sessions. The
threat model is stored XSS by definition. Any approach that ships
agent-authored JavaScript in-process is unsafe, full stop.

This doc captures the architecture we *do* want: iframe-sandboxed
React widgets, compiled in-browser from JSX with sucrase, where the
agent writes a real component against a curated scope. Same pattern
ChatGPT Apps, Claude Artifacts, CodeSandbox, and StackBlitz use.

---

## 2. Goals & non-goals

**Goals**

- The agent writes a real React component (JSX). No bespoke language,
  no expression evaluator, no schema mirror.
- The component renders inside a **sandboxed iframe on a different
  origin** from the host. No access to host cookies, host DOM, host
  auth, host storage, host network.
- The component can use a **curated scope**: React hooks + a stable
  set of our component primitives (`Card`, `Button`, `Chart`, `Graph`,
  `Input`, etc.). Anything else is a `ReferenceError`.
- The component can ask the host to do things via **postMessage RPC**
  (save widget state, call a tool, navigate, open a note). The host
  decides whether to honor each request.
- Visual parity with the host app: same Tailwind tokens, same dark
  mode, same primitives — because the iframe ships *the same source
  components*, just bundled separately.
- Validation = "does sucrase parse + does it return a component?"
  No bespoke validator stack.

**Non-goals (v1)**

- Defense against a sandbox-bypass-grade attacker. The iframe's
  `sandbox` attribute + cross-origin treatment is our boundary. If
  a browser-level sandbox-escape ever becomes a concern, that's a
  separate, larger problem.
- Multi-file mini-apps. One source string, one component. Match
  Claude Artifacts' constraint.
- Server-side execution. The mini-app runtime is browser-only. If
  agents want to do real work, they call tools via RPC and the host
  proxies the work.
- Network access from the iframe. CSP locks `connect-src` to either
  `'none'` or a tiny allowlist (e.g. our own message origin). No
  `fetch` to arbitrary endpoints.
- Real-time collab on widget *state*. The widget's JSX source is
  collab-persisted (it lives in a note), but the widget's runtime
  state is local to the viewer's session. Two viewers may see two
  different counter values. Sharing widget state cleanly is a Phase 2
  problem.
- A general code-execution platform. This is for visual, interactive
  widgets agents author. Not for running user scripts, not for
  prototyping React in the browser, not for shared utilities.
- "Hot reload" while the agent streams. v1 receives the complete
  source via `write_note`, renders once. Streaming preview is a
  future polish.

---

## 3. Mental model

A **mini-app** is a single React component the agent wrote, persisted
as a string on a note, and rendered inside an isolated iframe when
viewers open the board. The iframe is a self-contained app that
loads its own copy of React, its own copy of our component library,
and a tiny runtime that compiles the agent's source on receipt.

The iframe is **cross-origin to the host app by design**. This is
the load-bearing security primitive — sandbox attribute alone is
not enough. The iframe is served from a different subdomain
(`mini-app.<your-domain>`) so the browser treats it as foreign code
for cookie / storage / parent-DOM purposes.

The agent's experience is "write a React component using the
identifiers in scope." The host's experience is "embed this string
in an iframe." Neither side needs to know about the other's
internals.

| Term | Definition |
| --- | --- |
| **Source** | The string the agent wrote. JSX text. Persisted on the note. The note's `content` column. |
| **Scope** | The map of identifiers (`useState`, `Card`, `Chart`, ...) the agent may reference. Defined inside the runtime, derived from the same registry that builds the agent's prompt. |
| **Registry** | The single source of truth that lists every identifier in scope + its type signature + its documentation snippet. Used by both the runtime (to populate scope) and the agent prompt (to enumerate capabilities). |
| **Runtime** | The bundled JS + CSS that lives at `mini-app.<your-domain>/runtime.js`. Includes React, ReactDOM, sucrase, the component library subset, and the compile-and-render pipeline. |
| **Host** | The parent React app at `dim0.net`. Mounts the iframe, sends the source via postMessage, handles RPC requests. |
| **RPC** | The JSON-RPC-over-postMessage contract between host and iframe. One direction: iframe asks, host decides. |
| **Sandbox** | The `<iframe sandbox="allow-scripts">` attribute, in combination with the runtime being served from a different origin. Together they enforce the security boundary. |

The simplest mental model: **the mini-app runtime is its own tiny app**,
shipped alongside the host. The host doesn't reach inside; the
runtime doesn't reach out. They speak postMessage.

---

## 4. High-level architecture

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                         Host app (dim0.net)                       │
 │                                                                   │
 │  ┌──────────────────────────────────────────────────────────┐    │
 │  │ Board canvas → MiniAppNode → MiniAppMount                │    │
 │  │   ┌────────────────────────────────────────────────────┐ │    │
 │  │   │ <iframe sandbox="allow-scripts"                    │ │    │
 │  │   │         src="https://mini-app.dim0.net/host.html" />│ │    │
 │  │   └─────────────────────────────┬──────────────────────┘ │    │
 │  │     postMessage bridge:         │                        │    │
 │  │       ready  ◀──────────────────┤                        │    │
 │  │       render ──────────────────▶│                        │    │
 │  │       rpc.<name>  ◀─────────────┤                        │    │
 │  │       rpc.<name>.result ───────▶│                        │    │
 │  └──────────────────────────────────────────────────────────┘    │
 └─────────────────────────────────────────────────────────────────┘
                              │
                              │  cross-origin postMessage
                              ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │              Iframe runtime  (mini-app.dim0.net)                  │
 │                                                                   │
 │   host.html  ─── loads ───▶  runtime.js + runtime.css             │
 │                                                                   │
 │   ┌─────────────────────────────────────────────────────────┐    │
 │   │  src/mini-app-runtime/main.tsx                          │    │
 │   │   • React 19 + ReactDOM root                            │    │
 │   │   • sucrase.transform(source, ...)                      │    │
 │   │   • new Function(...scopeNames, transpiled)             │    │
 │   │   • render <LiveError> on compile/runtime failure       │    │
 │   │   • registry-driven SCOPE = { useState, Card, ... }     │    │
 │   │   • postMessage RPC helper exposed under host.* in scope│    │
 │   └─────────────────────────────────────────────────────────┘    │
 │                                                                   │
 │   CSP:  script-src 'self' 'unsafe-eval';                          │
 │         connect-src 'none';                                       │
 │         frame-ancestors https://dim0.net;                         │
 └─────────────────────────────────────────────────────────────────┘
```

**Two builds, two origins.** The host bundle lives at `dim0.net`.
The runtime bundle lives at `mini-app.dim0.net`. Same monorepo,
same Vite project, two entry points.

**One source code, two builds of components.** `Card`, `Button`,
etc. are imported into both the host bundle (for the rest of the
app) and the runtime bundle (for mini-app scope). Each bundle has
its own copy of the same component module — visually identical,
JS-isolated.

**postMessage is the only cross-frame channel.** No callbacks pass
through, no shared React state, no shared store. The host serializes
intent into JSON; the iframe deserializes; results come back the
same way.

---

## 5. Origin strategy

**Pick a separate subdomain for the runtime.** This is non-negotiable.

The browser's same-origin policy is the load-bearing security
primitive. `<iframe sandbox="allow-scripts">` *alone* is not enough
if the iframe is on the same origin as the host — `allow-scripts`
allows JavaScript execution, which can then `parent.document` and
read host cookies via `document.cookie` (within the same origin).

Hosting the runtime on a different subdomain like `mini-app.dim0.net`:

- Makes the iframe **cross-origin** to the host. `parent.document`
  throws. `document.cookie` reads only iframe-origin cookies (none).
- Storage (`localStorage`, `sessionStorage`, `IndexedDB`) is per-origin.
  The iframe has its own empty storage; host's storage is invisible.
- Credentialed fetch to the host's API is blocked by browser without
  CORS allowing it (which we don't add).
- The host can require an `X-Frame-Options` / `Content-Security-Policy:
  frame-ancestors` lock so the runtime can only be embedded by us.

**Prior art.** ChatGPT serves widgets from `*.web-sandbox.oaiusercontent.com`.
CodeSandbox previews live at `csb.app`. GitHub raw content is on
`raw.githubusercontent.com`. None of these would be safe on the
main origin.

**Production setup.**

- DNS: `mini-app.dim0.net` → static asset bucket / CDN
- Bucket serves: `host.html`, `runtime.[hash].js`, `runtime.[hash].css`
- Cache: aggressive — hashed filenames, immutable
- TLS: yes, browser blocks mixed-content iframes
- CORS headers on the bucket: not strictly needed (iframes load
  scripts cross-origin without CORS)
- Local dev: a second Vite dev server on a different port + a `127.0.0.1.nip.io`-style hostname so cross-origin behaves like production

---

## 6. Build setup

Add a second entry point to the existing Vite build.

```
webui/
  index.html                  ← host entry
  src/main.tsx                ← host entry
  ...
  mini-app-runtime/
    index.html                ← runtime entry (small)
    main.tsx                  ← runtime React root + postMessage bridge
    compile.ts                ← sucrase + new Function wrapper
    scope.ts                  ← MINI_APP_SCOPE registry
    rpc.ts                    ← host.* helper exposed to user code
    error-display.tsx         ← in-iframe error UI
```

`vite.config.ts`:

```ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:        resolve(__dirname, "index.html"),
        miniAppRun:  resolve(__dirname, "mini-app-runtime/index.html"),
      },
    },
  },
})
```

The runtime entry's HTML is minimal:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   script-src 'self' 'unsafe-eval';
                   style-src 'self' 'unsafe-inline';
                   img-src 'self' data: blob:;
                   font-src 'self' data:;
                   connect-src 'none';
                   frame-ancestors https://dim0.net;" />
    <link rel="stylesheet" href="/runtime.css" />
  </head>
  <body class="bg-background text-foreground">
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

Note `unsafe-eval` in `script-src` — sucrase + `new Function`
require it. This is *fine* because the iframe is the security
boundary, not the CSP. CSP here is defense-in-depth: locks
`connect-src` to `'none'` so even arbitrary `new Function` code
can't `fetch()` out.

### 6.1 Env vars

The host bundle and the runtime bundle each need to know about
the *other's* origin so they can validate incoming `postMessage`
events. Two vars, opposite directions:

| Var | Used by | Meaning |
|---|---|---|
| `VITE_MINI_APP_ORIGIN` | host bundle | where the host loads the runtime iframe from |
| `VITE_HOST_ORIGIN` | runtime bundle | which origin's postMessages the runtime trusts |

Both **must include scheme and port** (origins, not hostnames):
`http://localhost:5174`, not `localhost:5174`. The browser's
`event.origin` always carries the scheme; validation by
hostname-only is a footgun.

**`webui/.env.development`** (committed):

```bash
VITE_HOST_ORIGIN=http://localhost:5173
VITE_MINI_APP_ORIGIN=http://localhost:5174
```

**`webui/.env.production`** (committed):

```bash
VITE_HOST_ORIGIN=https://dim0.net
VITE_MINI_APP_ORIGIN=https://mini-app.dim0.net
```

**`webui/.env.local`** (gitignored — overrides for individual
devs, e.g. pointing dev at staging):

```bash
# VITE_MINI_APP_ORIGIN=https://mini-app-staging.dim0.net
```

**Type declaration** in `webui/vite-env.d.ts`:

```ts
interface ImportMetaEnv {
  readonly VITE_HOST_ORIGIN: string
  readonly VITE_MINI_APP_ORIGIN: string
  // … other VITE_ vars
}
```

Typing them as `string` (not `string | undefined`) means a missing
env var is caught at build time, not as a silent `undefined` at
runtime — the bug where origin validation reads `event.origin !==
undefined` and rejects every message.

**Runtime guard** at the top of both `main.tsx` files for belt-and-
braces:

```ts
if (!import.meta.env.VITE_HOST_ORIGIN)     throw new Error("VITE_HOST_ORIGIN not set")
if (!import.meta.env.VITE_MINI_APP_ORIGIN) throw new Error("VITE_MINI_APP_ORIGIN not set")
```

Vite reads `.env.*` files automatically per mode (`npm run dev` →
`.env.development`, `npm run build` → `.env.production`); CI can
override either via shell env. Both `main.tsx` (host) and
`mini-app-runtime/main.tsx` share the same Vite env config since
they're both in the same project — naming the vars by direction
(`HOST_` vs `MINI_APP_`) avoids any "which side reads which"
confusion.

### 6.2 Local dev hostnames

Different **ports** count as different origins per the same-origin
policy — so `localhost:5173` ↔ `localhost:5174` already gives us
the cross-origin treatment we need for dev. No `/etc/hosts` edits,
no `nip.io`, no subdomain DNS.

We only escalate to subdomain-shaped dev hostnames (via `nip.io`
or hosts file) if we hit a behavior that differs between
"different ports on same host" and "different subdomains on same
registrable domain" — e.g. cookie-domain quirks we hit later.
Production already uses subdomains; if a production-only bug
surfaces, that's when nip.io earns its keep.

---

## 7. The compile pipeline

The runtime's compile step is ~80 lines on top of sucrase. No
react-live dependency — we don't ship the editor UI it bundles.

```ts
// mini-app-runtime/compile.ts
import { transform } from "sucrase"

import { MINI_APP_SCOPE_VALUES, MINI_APP_SCOPE_NAMES } from "./scope"

export type CompileResult =
  | { ok: true;  Component: () => React.ReactElement | null }
  | { ok: false; error: CompileError }

export interface CompileError {
  kind: "compile" | "runtime"
  message: string
  line?: number
  column?: number
}

export function compileMiniApp(source: string): CompileResult {
  let transpiled: string
  try {
    transpiled = transform(source, {
      transforms: ["jsx", "typescript"],
      production: true,
      jsxRuntime: "classic",
    }).code
  } catch (err) {
    return { ok: false, error: toCompileError("compile", err) }
  }

  // Convention: the agent defines a top-level `Widget` function.
  // The runtime returns it. Fallbacks: `App`, then `default export`
  // (we handle the default export by rewriting it during transform).
  const body = `
    "use strict";
    ${transpiled}
    return typeof Widget !== "undefined" ? Widget
         : typeof App    !== "undefined" ? App
         : null;
  `

  let factory: (...args: unknown[]) => unknown
  try {
    factory = new Function(...MINI_APP_SCOPE_NAMES, body) as never
  } catch (err) {
    return { ok: false, error: toCompileError("compile", err) }
  }

  let Component: unknown
  try {
    Component = factory(...MINI_APP_SCOPE_VALUES)
  } catch (err) {
    return { ok: false, error: toCompileError("runtime", err) }
  }

  if (typeof Component !== "function") {
    return {
      ok: false,
      error: { kind: "compile", message: "no Widget or App export found" },
    }
  }

  return { ok: true, Component: Component as () => React.ReactElement }
}
```

**Errors return a structured value**, not exceptions. The
runtime renders an inline error UI for `kind: "compile"` and uses
React's error boundary for `kind: "runtime"`. Compile errors
include line/column from sucrase's diagnostics; the agent gets
them on its next attempt via the `validate_note` tool.

---

## 8. Scope registry

One file, two consumers.

```ts
// mini-app-runtime/scope.ts
import { useState, useMemo, useEffect, useCallback, useReducer, useRef } from "react"

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ChartElement as Chart } from "./components/chart"
import { GraphElement as Graph } from "./components/graph"
import { cn } from "@/lib/utils"

import { host } from "./rpc"          // see §10

interface ScopeEntry {
  value: unknown
  signature: string  // for the agent prompt
  doc?: string       // short docstring, for the agent prompt
}

export const MINI_APP_SCOPE: Record<string, ScopeEntry> = {
  // React hooks
  useState:    { value: useState,   signature: "useState<T>(initial: T): [T, Setter<T>]",
                 doc: "Local widget state. Resets on re-render of the parent iframe." },
  useMemo:     { value: useMemo,    signature: "useMemo<T>(fn: () => T, deps: any[]): T" },
  useEffect:   { value: useEffect,  signature: "useEffect(fn: () => void | (() => void), deps?: any[]): void" },
  useCallback: { value: useCallback, signature: "useCallback<F>(fn: F, deps: any[]): F" },
  useReducer:  { value: useReducer, signature: "useReducer<S,A>(reducer, init): [S, (a:A)=>void]" },
  useRef:      { value: useRef,     signature: "useRef<T>(initial: T): { current: T }" },

  // Component library
  Card:        { value: Card,        signature: "<Card className?>{children}</Card>" },
  CardHeader:  { value: CardHeader,  signature: "<CardHeader>{children}</CardHeader>" },
  CardTitle:   { value: CardTitle,   signature: "<CardTitle>{children}</CardTitle>" },
  CardContent: { value: CardContent, signature: "<CardContent>{children}</CardContent>" },
  CardFooter:  { value: CardFooter,  signature: "<CardFooter>{children}</CardFooter>" },
  Button:      { value: Button,      signature: "<Button variant? size? onClick?>{children}</Button>" },
  Input:       { value: Input,       signature: "<Input value onChange placeholder? type?/>" },
  Checkbox:    { value: Checkbox,    signature: "<Checkbox checked onCheckedChange/>" },
  Label:       { value: Label,       signature: "<Label htmlFor?>{children}</Label>" },

  // Visual primitives
  Chart:       { value: Chart,       signature: "<Chart kind data labels? height? />",
                 doc: "Cartesian or pie chart. kind: 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'composed'." },
  Graph:       { value: Graph,       signature: "<Graph nodes edges viewBox? />",
                 doc: "Node-link diagram. nodes: {id,x,y,label?,...}[], edges: {a,b,label?,...}[]." },

  // Helpers
  cn:          { value: cn,          signature: "cn(...classes: (string|undefined)[]): string" },

  // Host RPC namespace
  host:        { value: host,        signature: "host.saveState(state), host.callTool(name, args), ...",
                 doc: "Curated RPC to the host app. See §10." },
}

export const MINI_APP_SCOPE_NAMES  = Object.keys(MINI_APP_SCOPE)
export const MINI_APP_SCOPE_VALUES = MINI_APP_SCOPE_NAMES.map(k => MINI_APP_SCOPE[k].value)

export function renderScopeManifest(): string {
  return MINI_APP_SCOPE_NAMES
    .map((name) => {
      const { signature, doc } = MINI_APP_SCOPE[name]
      return doc
        ? `- \`${name}\`: ${signature}\n  ${doc}`
        : `- \`${name}\`: ${signature}`
    })
    .join("\n")
}
```

The skill prompt (delivered to the agent via the `learn_generate_mini_app`
tool) literally inlines `renderScopeManifest()`. The agent's
allowlist and the runtime's allowlist are *the same data* — no
drift possible.

Adding a component is a one-line change in `scope.ts`. Removing one
is a one-line change. The agent's next request sees the updated
manifest.

---

## 9. The iframe runtime

```tsx
// mini-app-runtime/main.tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { compileMiniApp } from "./compile"
import { ErrorDisplay } from "./error-display"
import { rpc } from "./rpc"
import "./runtime.css"

const root = createRoot(document.getElementById("root")!)

let currentSource: string | null = null

window.addEventListener("message", (event) => {
  if (event.origin !== HOST_ORIGIN) return  // see §11 on origin checks
  const msg = event.data
  if (msg?.type === "mini-app:render") {
    currentSource = msg.source
    void renderCurrent(msg.theme)
  } else if (msg?.type === "mini-app:theme") {
    document.documentElement.classList.toggle("dark", msg.theme === "dark")
  } else {
    rpc.handleHostMessage(msg)
  }
})

async function renderCurrent(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark")
  if (!currentSource) return
  const result = compileMiniApp(currentSource)
  if (!result.ok) {
    root.render(<ErrorDisplay error={result.error} />)
    return
  }
  const Widget = result.Component
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <Widget />
      </ErrorBoundary>
    </StrictMode>
  )
}

window.parent.postMessage({ type: "mini-app:ready" }, HOST_ORIGIN)

// Auto-resize: observe body, post height changes to the host.
new ResizeObserver(() => {
  window.parent.postMessage(
    { type: "mini-app:resize", height: document.body.scrollHeight },
    HOST_ORIGIN
  )
}).observe(document.body)
```

`HOST_ORIGIN` is baked in at build time per environment
(`https://dim0.net` in prod, `http://localhost:5173` in dev).

The host side mirrors this:

```tsx
// webui/src/features/board/.../mini-app/mount.tsx
const RUNTIME_ORIGIN = import.meta.env.VITE_MINI_APP_ORIGIN
  // "https://mini-app.dim0.net" in prod

export function MiniAppMount({ source }: { source: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(240)
  const theme = useTheme()  // host's theme

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== RUNTIME_ORIGIN) return
      if (e.source !== iframeRef.current?.contentWindow) return
      const msg = e.data
      switch (msg?.type) {
        case "mini-app:ready":
          iframeRef.current?.contentWindow?.postMessage(
            { type: "mini-app:render", source, theme },
            RUNTIME_ORIGIN,
          )
          break
        case "mini-app:resize":
          setHeight(msg.height)
          break
        case "mini-app:rpc":
          handleRpc(msg, iframeRef.current!.contentWindow!)
          break
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [source, theme])

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      src={`${RUNTIME_ORIGIN}/host.html`}
      style={{ width: "100%", height, border: 0 }}
    />
  )
}
```

**Origin checks on both sides.** Production-grade postMessage
handlers always verify `event.origin`. Without that, any
cross-origin frame could spoof messages.

---

## 10. RPC contract

The mini-app cannot reach the host directly — different origin,
cross-frame. Instead, the runtime exposes a `host` object in scope
that the agent's code can call. Each method translates to a
`postMessage` request; the host receives, decides, and replies.

```ts
// mini-app-runtime/rpc.ts
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function send<T>(method: string, args: unknown): Promise<T> {
  const id = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as never, reject })
    window.parent.postMessage(
      { type: "mini-app:rpc", id, method, args },
      HOST_ORIGIN
    )
  })
}

export const host = {
  saveState: (state: unknown) => send<void>("saveState", state),
  callTool:  (name: string, args: unknown) => send<unknown>("callTool", { name, args }),
  openNote:  (noteId: string) => send<void>("openNote", { noteId }),
  toast:     (message: string, level?: "info" | "error") => send<void>("toast", { message, level }),
}

export const rpc = {
  handleHostMessage(msg: unknown) {
    if (typeof msg !== "object" || msg === null) return
    const { id, result, error } = msg as { id?: string; result?: unknown; error?: string }
    if (!id) return
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (error) p.reject(new Error(error))
    else p.resolve(result)
  },
}
```

The host-side `handleRpc` dispatches on `method`, applies its own
authorization rules (does this user own this note? is this tool
permitted from a widget?), and replies with `{ id, result }` or
`{ id, error }`.

**Adding an RPC method is a four-step change**, all in one PR:

1. Add it to the `host` object in `rpc.ts`
2. Add the dispatch case in the host's `handleRpc`
3. Update the scope manifest doc in `scope.ts` so the agent learns
4. Add an integration test

No schema mirror, no parity tests.

---

## 11. Security model

**Threat: untrusted JS in user-generated content.** A widget
authored by user A is persisted, then renders in user B's browser.
Without isolation, A can run JS in B's session — credential theft,
data exfiltration, navigation hijacking.

**Boundary: sandbox attribute + cross-origin runtime.** Together
these enforce:

| Capability | Iframe with `sandbox="allow-scripts"` on `mini-app.dim0.net` |
|---|---|
| Read host (`dim0.net`) cookies | ❌ cross-origin |
| Read host `localStorage` | ❌ different origin |
| Read iframe `localStorage` | ❌ sandbox blocks storage |
| `parent.document` access | ❌ cross-origin |
| Credentialed `fetch` to host API | ❌ cross-origin without CORS |
| Network requests to anywhere | ❌ CSP `connect-src 'none'` |
| Navigate top window | ❌ sandbox blocks `top.location =` |
| Drop sandbox attribute | ❌ would require `allow-same-origin` (we never grant) |

The CSP inside the iframe adds defense in depth:

```
default-src 'none';
script-src 'self' 'unsafe-eval';   ← sucrase needs eval
style-src  'self' 'unsafe-inline'; ← Tailwind JIT inlines
img-src    'self' data: blob:;
font-src   'self' data:;
connect-src 'none';                ← strict — no fetch at all
frame-ancestors https://dim0.net;  ← only we may embed it
```

`unsafe-eval` is the one "scary" allowance. It's needed because
`new Function` is how sucrase-compiled code gets executed. It's
*safe in context* because:

1. The iframe is sandboxed → eval'd code has no parent-frame access.
2. `connect-src 'none'` → eval'd code can't `fetch` out.
3. Cross-origin → eval'd code can't touch host cookies/storage.

The combination is sound. No single layer is.

**What we do not defend against.**

- Browser sandbox escape exploits (kernel-level). Out of scope —
  same exposure as visiting any website.
- Denial of service via infinite loops in widget code. v1 doesn't
  ship a watchdog. If it becomes a problem, we add `Promise.race`
  with a timeout in the compile path.
- Resource exhaustion (memory, DOM nodes). Browser handles. We
  don't artificially cap.

---

## 12. Persistence

The widget's **source** lives on the note (`content` column,
content_type: `mini_app`). Same lifecycle as any other note:
collab-synced via existing WS path, persisted to Postgres.

The widget's **runtime state** (e.g. counter value, todo items)
is *not* collab-synced in v1. Two users viewing the same widget
see two independent state trees. This is a deliberate scope cut
— shared runtime state is a real product question (what does
"two users editing the same counter" mean?) we don't have an
answer to yet.

The widget can persist its state via `host.saveState(state)`. The
host writes it to a sidecar table or a JSON field on the note.
On next mount, the host passes it to the iframe in the initial
`render` message:

```ts
{ type: "mini-app:render", source, savedState, theme }
```

The widget reads it via a sibling helper in scope:

```ts
const [count, setCount] = useState(host.initialState ?? 0)
useEffect(() => { host.saveState(count) }, [count])
```

Whether this state is per-user or shared is a host-side policy
question, not a runtime question. v1: per-user (each viewer has
their own state). v2: configurable.

---

## 13. Theme propagation

The iframe ships its own Tailwind CSS. Dark mode in our app is
class-based (`<html class="dark">`). The host posts the current
theme on every `render`; the iframe sets the class on its own
`<html>`. Done.

```ts
// host
postMessage({ type: "mini-app:render", source, theme: isDark ? "dark" : "light" }, ORIGIN)
postMessage({ type: "mini-app:theme",  theme: isDark ? "dark" : "light" }, ORIGIN)  // updates

// iframe
document.documentElement.classList.toggle("dark", msg.theme === "dark")
```

Design tokens stay consistent because the runtime imports
`tailwind.config` from the same source as the host. Bundled
twice; visually identical.

---

## 14. Testing — deferred to v2

**v1 ships without an agent-runnable test harness.** The agent
writes the widget; sucrase catches compile errors; runtime errors
surface in the user's browser. That's it.

Why this is the right deferral, not a gap:

1. **The hard problem is the Python↔JS bridge.** Running
   React-with-DOM from a Python backend means one of: a Node
   subprocess (extra deploy dep), Playwright in Python (~150MB
   Chromium), or async push-to-browser via WS. All workable but
   all add real infrastructure for a v2 feature.
2. **Agents are moving browser-side.** Once the agent loop runs
   in the user's browser (planned), the test harness is *free*
   — same JS context, direct iframe access, no serialization,
   no subprocess, no async boundary. The Python-era test API
   would be discarded anyway.
3. **Compile validation alone covers 60-70% of the failures.**
   Sucrase rejects syntax errors and (when scope-checked)
   undefined identifiers. The remaining cases are logic bugs
   that a user catches on first interaction.
4. **The feedback loop already works.** User opens widget → it's
   broken → user says "fix this" → agent reads the chat message →
   agent fixes. Average latency: seconds. The cost of shipping a
   broken counter widget is nearly zero.
5. **Decouples the architecture decision.** The iframe-sandboxed
   runtime is a real piece of infrastructure that shouldn't be
   gated on solving testing. Get §5–§13 right; v2 adds tests on
   top with zero refactoring (the runtime mounts; the harness just
   talks to it differently depending on who's driving — backend
   or browser-side agent).

### Forward shape (v2, browser-side agents)

When agents move to the browser, the testing API becomes a
direct in-process call:

```ts
// In the browser-side agent code:
const result = await miniAppHarness.run({
  source: agentDraftSource,
  tests: [
    { name: "starts at zero", body: "..." },
    { name: "click increments", body: "..." },
  ],
})
if (!result.ok) {
  // feed result.failures back into the agent's context
}
```

No backend involvement. Same iframe runtime, mounted invisibly
by the agent itself. We design this when we're ready, with the
benefit of all the lessons from running v1 in production.

### What v1 stores anyway

The note's `content` is the raw source. **Nothing test-shaped
is parsed out.** If the agent happens to write `host.test(...)`
calls in the source (e.g. because the prompt encouraged it),
they execute as side-effect-free no-ops — `host.test` is just
not in scope in v1, so it becomes a `ReferenceError` and the
compile rejects. v1 prompt: "do not call `host.test`."

---

## 15. Comparison to alternatives

| Approach | Multi-user safe | Agent reliability | Expressivity | Maintenance |
|---|---|---|---|---|
| **Static HTML widget** (today) | ✅ yes | ✅ high (HTML in training) | ⚠ no interactivity | ✅ low |
| **YAML/JSON DSL** (the abandoned attempt) | ⚠ depends on tier-2 JS | ❌ low (no priors) | ⚠ partial | ❌ high (4 schemas) |
| **A2UI catalog** (JSON + components) | ✅ yes | ⚠ medium (newer format) | ⚠ no agent-written logic | ⚠ medium (catalog) |
| **Same-frame react-live** | ❌ stored XSS | ✅ high (real React) | ✅ full | ✅ low |
| **Sandpack (`@codesandbox/sandpack-client`)** | ✅ yes | ✅ high | ✅ full + arbitrary npm | ⚠ medium (their bundler, their semantics) |
| **iframe-sandboxed sucrase + React** (this doc) | ✅ yes | ✅ high (real React) | ✅ full | ✅ low |

The static HTML widget stays as the **default** content type for
notes-as-information. Mini-apps are the **escape hatch** when
interactivity is genuinely required (forms, counters, lists,
visualizers, dashboards with controls).

### 15.1 Why not Sandpack (settled, not an open question)

[Sandpack](https://sandpack.codesandbox.io/) is CodeSandbox's
embeddable iframe runtime. It implements exactly the cross-origin
iframe + postMessage bridge pattern we want, *and* it's production-grade.
We considered it. We're not using it. Reasons:

1. **Abstraction mismatch.** Sandpack's mental model is "agent
   writes a React app, can import any npm package, we resolve
   them dynamically via an in-iframe bundler." Our mental model
   is "agent writes one component against a fixed list of
   identifiers, nothing else." We'd be using ~5% of what Sandpack
   offers and paying the full price.

2. **Bundle weight.** The `sandpack-bundler` iframe app is
   MB-scale because it carries an npm-resolver + worker-based
   transpilation pipeline. We don't need either; sucrase alone
   (~80KB gz) handles JSX/TS and that's the only language feature
   we want.

3. **Scope injection is awkward.** Sandpack's "scope" is at the
   bundler level — you provide files that get imported. There's
   no clean primitive for "inject these JS references at runtime
   so the agent's code can call `host.callTool(...)`." We'd be
   smuggling our RPC namespace through fake npm package files.

4. **Their bundler URL.** Default is `*.codesandbox.io`. Either
   we depend on their infra (which goes down sometimes, isn't
   ours to monitor) or we self-host their open-source bundler
   (adds another deployable to our pipeline for no benefit).

5. **Latency.** Every widget mount triggers a bundling step. Our
   approach pre-loads the runtime once per session; widgets after
   the first one only pay the compile cost (~1ms with sucrase).

**What we keep from studying Sandpack:** the cross-origin pattern,
the `Client` postMessage protocol shape, the `bundlerURL`
configurability idea (we apply it to our own runtime), the
templates concept (we'll have a single template — `Widget` —
not 30). Their code is a great reference, just not a fit as a
dependency.

The Renderify project (referenced earlier) is in the same bucket
as Sandpack — useful pattern, wrong scope for us.

---

## 16. What we delete from the abandoned DSL effort

If/when we ship this architecture, the following can be removed
from the codebase (currently on the `feat/widget-dsl` branch,
never merged):

- `webui/src/features/widget-dsl/` (entire directory: schema, expression
  parser, expression tests, render, render tests, element-defaults,
  elements/, runtime, types)
- `backend/topix/widget_dsl/` (models, parse, serialize, validation,
  custom_elements)
- `backend/topix/prompts/widget/learn_generate_mini_app.jinja` (the
  DSL skill prompt — replaced by a much smaller one that inlines
  `renderScopeManifest()`)
- All Pydantic↔Zod parity tests under `backend/test/unit/widget_dsl/`
  and `webui/src/features/widget-dsl/__fixtures__/`
- The `validate_note` tool's MINI_APP branch — collapses to "try to
  compile via sucrase, return errors if any"

What we keep from that branch:

- `MiniAppNode` type registration in the canvas-harness
- `MiniAppMount` host component (rewritten to talk to the iframe)
- The chart and graph React components themselves (they move to
  `mini-app-runtime/components/` for the runtime bundle)

---

## 17. Implementation roadmap

Rough sequencing — every step shippable, no big-bang merge.

**Phase 0 — scaffolding (½ day)**

1. Add the second Vite entry point + a `npm run dev:mini-app`
   script binding port 5174 (host stays on 5173)
2. Wire env vars per §6.1: `VITE_HOST_ORIGIN` + `VITE_MINI_APP_ORIGIN`
   in `.env.development` and `.env.production`
3. Empty `index.html` + `main.tsx` that just `postMessage("ready")`
   to `VITE_HOST_ORIGIN`
4. Plan production subdomain (`mini-app.dim0.net`) — DNS + CDN
   bucket — but don't deploy yet
5. Verify cross-origin iframe loading works locally (different
   ports = cross-origin; subdomains only needed in prod per §6.2)

**Phase 1 — compile + scope (1 day)**

1. Add `sucrase` to the runtime entry's bundle
2. Write `compile.ts` + a handful of `compile.test.ts` cases
3. Define a minimal `MINI_APP_SCOPE` (React hooks + `Card` + `Button`)
4. Wire the postMessage `render` flow end-to-end with a hardcoded
   `function Widget() { return <Card><Button>hi</Button></Card> }`

**Phase 2 — RPC + state (1 day)**

1. `host.saveState` / `host.callTool` skeletons on both sides
2. Per-note `saved_state` column or sidecar table on backend
3. Pass `savedState` through the `render` message
4. Integration test: counter widget that survives a reload

**Phase 3 — agent integration (1 day)**

1. Rewrite `learn_generate_mini_app` to be tiny — just the
   manifest from `renderScopeManifest()` + 2-3 worked examples
2. Wire the new `validate_note` MINI_APP path: compile the source
   via sucrase (subprocess Node or in-Python via PyMiniRacer +
   bundled sucrase.js), return any compile errors as
   `ValidationIssue`s. **Compile-only — no test execution in v1
   (see §14).**
3. Verify a counter, a todo, and a chart widget end-to-end
   through the agent

**Phase 4 — production hardening (1 day)**

1. CSP headers (meta-tag in dev; HTTP header in prod via CDN/Caddy)
2. `X-Frame-Options` / `frame-ancestors` lock
3. Theme propagation
4. Auto-resize via ResizeObserver
5. Error UI inside the iframe (compile errors, runtime errors —
   user-facing, not agent-facing)

**Phase 5 — cleanup (½ day)**

1. Delete `feat/widget-dsl` branch / its `widget-dsl/` directories
2. Update root `AGENTS.md` and `CLAUDE.md` to reference this doc

Estimated total: **~4–5 days of focused work**, dropping testing
from v1 trims about a day off the original estimate.

---

## 18. Open questions

These are flagged for the implementation phase, not blockers.

- **Convention for the agent's exported component.** `function Widget()`
  vs `export default`? Picking `Widget` keeps the wrapper simple
  (no need to parse exports), is a small lift for the agent.
- **Multi-widget composition.** Can a mini-app `import` another
  by note ID? v1: no. v2 maybe.
- **Streaming.** When the agent streams JSX, do we re-compile on
  every chunk? Sucrase is fast enough (~1ms small docs) but the
  UX flicker is real. v1: no streaming, full compile on completion.
- **Sucrase delivery to the backend.** Phase 3 needs to run sucrase
  server-side for compile validation. Options: (a) Node subprocess
  with a tiny `compile-cli.js`, (b) `py-mini-racer` + bundled
  `sucrase.js` in the Python process. (a) is more boring; (b) is
  more self-contained. Settle in Phase 3.
- **Watchdog for runaway widgets.** Should we kill an iframe that
  blocks the main thread for >Xms? Browsers handle this poorly. Defer.
- **Browser-side agents and the testing harness.** When the agent
  loop moves into the user's browser, in-iframe testing becomes
  free (see §14). Revisit then, not before.

---

## 19. References

- ChatGPT Apps reverse-engineered: [I Reverse Engineered ChatGPT Apps Iframe Sandbox](https://dev.to/infoxicator/i-reverse-engineered-chatgpt-apps-iframe-sandbox-2ok3)
- Claude Artifacts implementation notes: [html2.app — Understanding Claude Artifacts](https://html2.app/blog/understanding-claude-artifacts)
- CodeSandbox embedding: [codesandbox.io/docs/embedding](https://codesandbox.io/docs/embedding)
- Sandpack (alternative runtime): [sandpack.codesandbox.io](https://sandpack.codesandbox.io/)
- Sucrase: [github.com/alangpierce/sucrase](https://github.com/alangpierce/sucrase)
- Sandboxed iframes (web.dev): [Play safely in sandboxed IFrames](https://web.dev/articles/sandboxed-iframes)
- A2UI (the catalog alternative): [a2ui.org](https://a2ui.org/)
- AG-UI (the transport protocol): [docs.ag-ui.com](https://docs.ag-ui.com/introduction)
