import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createMessageHandler,
  dispatchRpc,
  type MessageHandlerDeps,
  type RpcRequest,
} from "./dispatch"


// The `state-client` module is mocked at the module level for tests
// that wire the component or driver to its real I/O. The dispatchRpc
// suite below injects mocks directly via deps for finer control.
vi.mock("./state-client", () => ({
  fetchMiniAppState: vi.fn(),
  saveMiniAppState: vi.fn(),
}))


function makeRpcDeps(overrides: Partial<Parameters<typeof dispatchRpc>[1]> = {}) {
  const saveState = vi.fn().mockResolvedValue(undefined)
  const toastInfo = vi.fn()
  const toastError = vi.fn()
  return {
    noteId: "note-1",
    saveState,
    toastInfo,
    toastError,
    ...overrides,
  }
}


describe("dispatchRpc", () => {
  it("calls saveState with the args and replies with success", async () => {
    const deps = makeRpcDeps()
    const reply = await dispatchRpc(
      { type: "mini-app:rpc", id: "1", method: "saveState", args: { count: 7 } },
      deps,
    )
    expect(deps.saveState).toHaveBeenCalledWith("note-1", { count: 7 })
    expect(reply).toEqual({ type: "mini-app:rpc-result", id: "1", result: undefined })
  })


  it("routes toast level=info to toastInfo and level=error to toastError", async () => {
    const deps = makeRpcDeps()
    await dispatchRpc(
      { type: "mini-app:rpc", id: "1", method: "toast", args: { message: "hi", level: "info" } },
      deps,
    )
    expect(deps.toastInfo).toHaveBeenCalledWith("hi")
    expect(deps.toastError).not.toHaveBeenCalled()

    await dispatchRpc(
      { type: "mini-app:rpc", id: "2", method: "toast", args: { message: "oops", level: "error" } },
      deps,
    )
    expect(deps.toastError).toHaveBeenCalledWith("oops")
  })


  it("defaults toast level to info when omitted", async () => {
    const deps = makeRpcDeps()
    await dispatchRpc(
      { type: "mini-app:rpc", id: "1", method: "toast", args: { message: "default" } },
      deps,
    )
    expect(deps.toastInfo).toHaveBeenCalledWith("default")
  })


  it("returns an error for genuinely unknown methods", async () => {
    const deps = makeRpcDeps()
    const reply = await dispatchRpc(
      { type: "mini-app:rpc", id: "1", method: "futureMethod", args: null },
      deps,
    )
    expect(reply.error).toMatch(/not implemented/)
  })


  it("surfaces saveState failures as an error result, not a thrown exception", async () => {
    const deps = makeRpcDeps({
      saveState: vi.fn().mockRejectedValue(new Error("network blip")),
    })
    const reply = await dispatchRpc(
      { type: "mini-app:rpc", id: "1", method: "saveState", args: 0 },
      deps,
    )
    expect(reply.error).toBe("network blip")
  })
})


describe("createMessageHandler", () => {
  let posted: unknown[]
  let onReady: () => void
  let onResize: (height: number) => void
  let saveState: (noteId: string, state: unknown) => Promise<void>
  let toastInfo: (message: string) => void
  let toastError: (message: string) => void
  let onReadyMock: ReturnType<typeof vi.fn>
  let onResizeMock: ReturnType<typeof vi.fn>
  let saveStateMock: ReturnType<typeof vi.fn>
  let toastInfoMock: ReturnType<typeof vi.fn>
  let toastErrorMock: ReturnType<typeof vi.fn>
  let iframeWindowStub: Window
  let handler: (event: MessageEvent) => void


  beforeEach(() => {
    posted = []
    onReadyMock = vi.fn()
    onResizeMock = vi.fn()
    saveStateMock = vi.fn().mockResolvedValue(undefined)
    toastInfoMock = vi.fn()
    toastErrorMock = vi.fn()
    // Bind typed views over the mocks so the deps object satisfies its
    // strict signatures while tests still introspect via the mocks.
    onReady = onReadyMock as () => void
    onResize = onResizeMock as (height: number) => void
    saveState = saveStateMock as (noteId: string, state: unknown) => Promise<void>
    toastInfo = toastInfoMock as (message: string) => void
    toastError = toastErrorMock as (message: string) => void

    // Use a real iframe's contentWindow as the trusted source. jsdom
    // provides one per iframe element and it's the same identity we'd
    // capture from `iframeRef.current.contentWindow` in production.
    const iframe = document.createElement("iframe")
    document.body.appendChild(iframe)
    iframeWindowStub = iframe.contentWindow as Window

    const deps: MessageHandlerDeps = {
      postToIframe: (msg) => posted.push(msg),
      getIframeWindow: () => iframeWindowStub,
      expectedOrigin: "http://runtime.test",
      noteId: "note-1",
      saveState,
      toastInfo,
      toastError,
      onReady,
      onResize,
    }
    handler = createMessageHandler(deps)
  })


  function fire(data: unknown, opts: { origin?: string; source?: MessageEventSource | null } = {}) {
    handler(
      new MessageEvent("message", {
        data,
        origin: opts.origin ?? "http://runtime.test",
        source: opts.source !== undefined ? opts.source : iframeWindowStub,
      }),
    )
  }


  it("ignores messages from a foreign origin", () => {
    fire({ type: "mini-app:ready" }, { origin: "http://attacker.test" })
    expect(onReadyMock).not.toHaveBeenCalled()
  })


  it("ignores messages with the wrong source window", () => {
    fire({ type: "mini-app:ready" }, { source: null })
    expect(onReadyMock).not.toHaveBeenCalled()
  })


  it("calls onReady for mini-app:ready", () => {
    fire({ type: "mini-app:ready" })
    expect(onReadyMock).toHaveBeenCalledOnce()
  })


  it("calls onResize for mini-app:resize with a positive height", () => {
    fire({ type: "mini-app:resize", height: 420 })
    expect(onResizeMock).toHaveBeenCalledWith(420)
  })


  it("ignores resize messages with non-positive height", () => {
    fire({ type: "mini-app:resize", height: -1 })
    fire({ type: "mini-app:resize", height: 0 })
    fire({ type: "mini-app:resize", height: "tall" })
    expect(onResizeMock).not.toHaveBeenCalled()
  })


  it("routes mini-app:rpc to the RPC dispatcher and posts the reply back", async () => {
    const rpc: RpcRequest = {
      type: "mini-app:rpc",
      id: "rpc-1",
      method: "saveState",
      args: { count: 9 },
    }
    fire(rpc)
    // dispatchRpc awaits saveState; flush microtasks so the post
    // happens before we assert.
    await Promise.resolve()
    await Promise.resolve()
    expect(saveStateMock).toHaveBeenCalledWith("note-1", { count: 9 })
    expect(posted).toHaveLength(1)
    expect(posted[0]).toEqual({ type: "mini-app:rpc-result", id: "rpc-1", result: undefined })
  })


  it("ignores RPC messages missing id or method", () => {
    fire({ type: "mini-app:rpc", id: "x" })          // no method
    fire({ type: "mini-app:rpc", method: "saveState" }) // no id
    fire({ type: "mini-app:rpc", id: 1, method: "saveState" }) // wrong id type
    expect(saveStateMock).not.toHaveBeenCalled()
    expect(posted).toHaveLength(0)
  })


  it("ignores non-object data payloads", () => {
    fire(null)
    fire("a string")
    fire(42)
    expect(onReadyMock).not.toHaveBeenCalled()
    expect(onResizeMock).not.toHaveBeenCalled()
  })


  it("ignores objects without a string `type` field", () => {
    fire({ type: 42 })
    fire({ notType: "mini-app:ready" })
    expect(onReadyMock).not.toHaveBeenCalled()
  })
})
