// Pure host-side message routing for the iframe protocol.
//
// Split from mount.tsx so the React component file exports only its
// component (react-refresh / Fast Refresh requires this). Everything
// here is framework-agnostic and unit-tested directly in mount.test.tsx.


// === Wire-format message types — must match webui/mini-app-runtime ===


export interface RpcRequest {
  type: "mini-app:rpc"
  id: string
  method: string
  args: unknown
}


export interface RpcResult {
  type: "mini-app:rpc-result"
  id: string
  result?: unknown
  error?: string
}


// === RPC dispatch ===


export interface RpcDeps {
  noteId: string
  saveState: (noteId: string, state: unknown) => Promise<void>
  toastInfo: (message: string) => void
  toastError: (message: string) => void
}


/**
 * Translate a single ``mini-app:rpc`` request from the iframe into the
 * matching host-side side effect and return the JSON reply payload.
 */
export async function dispatchRpc(
  request: RpcRequest,
  deps: RpcDeps,
): Promise<RpcResult> {
  try {
    switch (request.method) {
      case "saveState":
        await deps.saveState(deps.noteId, request.args)
        return { type: "mini-app:rpc-result", id: request.id, result: undefined }
      case "toast": {
        const args = request.args as { message?: string; level?: "info" | "error" }
        const message = typeof args?.message === "string" ? args.message : ""
        if (args?.level === "error") deps.toastError(message)
        else deps.toastInfo(message)
        return { type: "mini-app:rpc-result", id: request.id, result: undefined }
      }
      default:
        // Unknown method. Today this only fires if the agent's code
        // posts a method we don't recognize — `callTool`/`openNote`
        // used to live as explicit cases here but were dropped from
        // the host bridge until they have real implementations.
        return {
          type: "mini-app:rpc-result",
          id: request.id,
          error: `${request.method} not implemented`,
        }
    }
  } catch (err) {
    return {
      type: "mini-app:rpc-result",
      id: request.id,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}


// === Message handler factory ===


export interface MessageHandlerDeps {
  /** Posts to the iframe (typed as a write-only callback to avoid Window references). */
  postToIframe: (msg: unknown) => void
  /** Provides the expected event.source for origin checks. Returns null if iframe not yet mounted. */
  getIframeWindow: () => Window | null
  /** Origin we trust messages from (cross-origin to the host app). */
  expectedOrigin: string
  noteId: string
  saveState: (noteId: string, state: unknown) => Promise<void>
  toastInfo: (message: string) => void
  toastError: (message: string) => void
  /** Invoked when the iframe handshakes ``mini-app:ready``. */
  onReady: () => void
  /** Invoked with the iframe's reported scroll-height for auto-resize. */
  onResize: (height: number) => void
}


/**
 * Build the message-event handler the React component registers on the
 * window. Exported so unit tests can drive synthetic ``MessageEvent``s
 * through it without rendering.
 */
export function createMessageHandler(
  deps: MessageHandlerDeps,
): (event: MessageEvent) => void {
  return (event) => {
    if (event.origin !== deps.expectedOrigin) return
    if (event.source !== deps.getIframeWindow()) return
    const data = event.data
    if (data == null || typeof data !== "object") return
    const type = (data as { type?: unknown }).type
    if (typeof type !== "string") return

    if (type === "mini-app:ready") {
      deps.onReady()
      return
    }

    if (type === "mini-app:resize") {
      const height = (data as { height?: unknown }).height
      if (typeof height === "number" && height > 0) {
        deps.onResize(height)
      }
      return
    }

    if (type === "mini-app:rpc") {
      const rpc = data as Partial<RpcRequest>
      if (typeof rpc.id !== "string" || typeof rpc.method !== "string") return
      void dispatchRpc(
        { type: "mini-app:rpc", id: rpc.id, method: rpc.method, args: rpc.args },
        {
          noteId: deps.noteId,
          saveState: deps.saveState,
          toastInfo: deps.toastInfo,
          toastError: deps.toastError,
        },
      ).then((reply) => deps.postToIframe(reply))
    }
  }
}
