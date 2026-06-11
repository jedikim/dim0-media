// Host RPC bridge — the `host` namespace agent code calls into.
//
// The iframe cannot reach the host directly (different origin, sandbox).
// Instead, each method here generates a request id, posts a
// `mini-app:rpc` message to `window.parent`, and returns a Promise. The
// host receives, decides whether to honor (and how), and replies with a
// `mini-app:rpc-result` message containing the same id + a result or
// an error string.
//
// The promise resolves on `result`, rejects on `error`. Agent code that
// just wants fire-and-forget (the typical saveState pattern in a
// useEffect) ignores the returned promise; the protocol still cleans
// up on the host's reply.
//
// `host.initialState` is the only non-method member: it carries the
// last-known persisted state for this widget mount, set by main.tsx
// from the `mini-app:render` payload before the agent's code runs.

const HOST_ORIGIN = import.meta.env.VITE_HOST_ORIGIN


type Resolver = { resolve: (value: unknown) => void; reject: (err: Error) => void }


const pending: Map<string, Resolver> = new Map()
let nextRequestId = 0


function send<T>(method: string, args: unknown): Promise<T> {
  const id = String(++nextRequestId)
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as Resolver["resolve"], reject })
    window.parent.postMessage(
      { type: "mini-app:rpc", id, method, args },
      HOST_ORIGIN,
    )
  })
}


// Mutable behind a getter so the agent's code reads via `host.initialState`
// as a plain property. main.tsx calls setHostInitialState() before invoking
// the compiled Widget, so the value is in place by the time useState(...)
// reads it on first render.
let initialStateValue: unknown = undefined


/**
 * Update the value `host.initialState` returns. Called by the runtime
 * entry on each `mini-app:render` message; not for use by agent code.
 */
export function setHostInitialState(value: unknown): void {
  initialStateValue = value
}


/**
 * The object injected into the agent's scope under the name `host`.
 *
 * v1 surface: `initialState`, `saveState`, `toast`. `callTool` and
 * `openNote` were sketched as stubs but only returned "not implemented"
 * errors, which produced confusing UX when the agent tried them. They
 * were dropped from the scope until there's a concrete need + real
 * implementation; reintroduce alongside an agent-callable handler in
 * dispatch.ts when that day comes.
 */
export const host = {
  /** Last persisted state for this widget mount, or undefined on first load. */
  get initialState(): unknown {
    return initialStateValue
  },

  /**
   * Persist `state` for this widget under the current user. Resolves
   * once the host confirms; rejects if the host couldn't store it.
   * Typical pattern: `useEffect(() => { host.saveState(value) }, [value])`.
   */
  saveState(state: unknown): Promise<void> {
    return send<void>("saveState", state)
  },

  /** Show a transient toast in the host app. Level defaults to "info". */
  toast(message: string, level?: "info" | "error"): Promise<void> {
    return send<void>("toast", { message, level })
  },
}


/**
 * Route a `mini-app:rpc-result` message to its waiting Promise.
 *
 * Returns true if the message was handled (so the caller can early-out
 * before checking other message types).
 */
export function handleHostMessage(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false
  const msg = data as {
    type?: string
    id?: string
    result?: unknown
    error?: string
  }
  if (msg.type !== "mini-app:rpc-result" || typeof msg.id !== "string") {
    return false
  }
  const entry = pending.get(msg.id)
  if (!entry) {
    // Unknown id — e.g. response to a request from a previous render.
    // Drop silently; no memory leak because we never added it.
    return true
  }
  pending.delete(msg.id)
  if (msg.error) {
    entry.reject(new Error(msg.error))
  } else {
    entry.resolve(msg.result)
  }
  return true
}


/**
 * Test-only: reset the internal id counter + pending map. Lets unit tests
 * run independently without leaking state between cases.
 */
export function _resetRpcForTests(): void {
  pending.clear()
  nextRequestId = 0
  initialStateValue = undefined
}
