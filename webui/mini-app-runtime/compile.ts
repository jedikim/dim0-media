// Compile agent-authored JSX into a callable React component.
//
// This is the engine the iframe runtime uses to turn a string of source
// (whatever the agent wrote) into something we can render. It's intentionally
// thin — sucrase does the parsing and JSX transform; everything else here is
// a `new Function` wrapper that injects a curated scope and pulls out the
// `Widget` (or `App`) identifier.
//
// Two failure modes, both surfaced as `{ ok: false, error }` rather than
// thrown exceptions, so callers can decide how to render them:
//
//   * `kind: "compile"` — sucrase rejected the source (syntax error) OR
//     no `Widget` / `App` was defined at the top level.
//   * `kind: "runtime"` — the body evaluated but invoking it threw
//     (e.g. references an identifier not in scope).
//
// Security note: the security boundary is the iframe sandbox + cross-origin
// treatment, not this function. We use `new Function` knowingly — the sandbox
// gives the iframe an opaque origin, so compiled code has no parent DOM access
// and no host cookies. Network egress, however, is NOT blocked by anything in
// this repo: a sandboxed iframe on an opaque origin can still `fetch()` and load
// external `<script src>`. Restricting network (e.g. `connect-src 'none'`)
// requires a Content-Security-Policy delivered by the deployment (Caddy response
// headers, see mini-app-deploy.md) — it is not shipped as a repo asset, so do
// not treat "no network" as guaranteed here. See mini-app-archi.md §11.

import { transform } from "sucrase"


/**
 * Result of attempting to compile + invoke a mini-app source string.
 *
 * Discriminated union so the caller can pattern-match on `ok` and get
 * a typed `Component` or `error` without further checks.
 */
export type CompileResult =
  | { ok: true;  Component: () => unknown }
  | { ok: false; error: CompileError }


export interface CompileError {
  kind: "compile" | "runtime"
  message: string
  /** 1-based line in the source. Only set when sucrase reported one. */
  line?: number
  /** 1-based column in the source. Only set when sucrase reported one. */
  column?: number
}


/**
 * Compile an agent-authored mini-app source string.
 *
 * `scope` is the map of identifiers that will be in scope as bare names
 * inside the user's code. Typically it includes `React`, hooks, a curated
 * component library, and host RPC helpers (see scope.ts).
 */
export function compileMiniApp(
  source: string,
  scope: Record<string, unknown>,
): CompileResult {
  // 1. Transpile JSX/TS → plain JS via sucrase.
  let transpiled: string
  try {
    const result = transform(source, {
      transforms: ["jsx", "typescript"],
      // `classic` mode emits `React.createElement(...)` rather than
      // importing from `react/jsx-runtime`. We don't have a module
      // system inside `new Function`, so classic is the only option.
      // The downside is `React` must be in scope — we ensure that in
      // scope.ts.
      jsxRuntime: "classic",
      production: true,
    })
    transpiled = result.code
  } catch (err) {
    return { ok: false, error: parseSucraseError(err) }
  }

  // 2. Wrap in a strict-mode function body that returns whichever of
  //    `Widget` / `App` the agent defined. We pick the first one
  //    found; arrow consts work the same as function declarations
  //    because `typeof` checks the binding name, not the AST form.
  const body =
    "\"use strict\";\n" +
    transpiled +
    "\n;return typeof Widget !== \"undefined\" ? Widget" +
    "\n      : typeof App    !== \"undefined\" ? App" +
    "\n      : null;"

  const scopeNames = Object.keys(scope)
  const scopeValues = scopeNames.map((name) => scope[name])

  // 3. Build the function. SyntaxErrors here are rare — sucrase
  //    catches almost everything — but a hand-written `body` template
  //    could still trip something on the agent's side.
  let factory: (...args: unknown[]) => unknown
  try {
    factory = new Function(...scopeNames, body) as never
  } catch (err) {
    return { ok: false, error: { kind: "compile", message: toMessage(err) } }
  }

  // 4. Evaluate top-level statements (function declarations, const
  //    bindings, the return). This *only* runs the top level; the
  //    Widget itself isn't invoked yet. So runtime errors inside
  //    Widget's body surface later, at render time, via the error
  //    boundary — not here.
  let component: unknown
  try {
    component = factory(...scopeValues)
  } catch (err) {
    return { ok: false, error: { kind: "runtime", message: toMessage(err) } }
  }

  if (typeof component !== "function") {
    return {
      ok: false,
      error: {
        kind: "compile",
        message:
          "no Widget or App component found — define `function Widget() { … }` " +
          "(or `const Widget = () => …`) at the top level of your source",
      },
    }
  }

  return { ok: true, Component: component as () => unknown }
}


/**
 * Sucrase throws `Error("… (line:col)")` for syntax problems. Try to
 * pull the position back out so the caller can show line/col to the
 * agent. If parsing the position fails, fall back to message-only.
 */
function parseSucraseError(err: unknown): CompileError {
  const message = toMessage(err)
  const match = /\((\d+):(\d+)\)/.exec(message)
  if (match) {
    return {
      kind: "compile",
      message,
      line: Number(match[1]),
      column: Number(match[2]),
    }
  }
  return { kind: "compile", message }
}


function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
