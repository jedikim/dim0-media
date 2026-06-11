import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  _resetRpcForTests,
  handleHostMessage,
  host,
  setHostInitialState,
} from "./rpc"


// jsdom's `window.parent` is the same window. We spy on postMessage to
// capture what the runtime sends, then synthesize the host's reply via
// handleHostMessage(). That covers the protocol round-trip without
// needing a real iframe.


describe("host.* RPC bridge", () => {
  let posted: { method: string; id: string; args: unknown }[]


  beforeEach(() => {
    _resetRpcForTests()
    posted = []
    vi.spyOn(window.parent, "postMessage").mockImplementation(
      (message: unknown) => {
        const msg = message as { type: string; id: string; method: string; args: unknown }
        if (msg?.type === "mini-app:rpc") {
          posted.push({ method: msg.method, id: msg.id, args: msg.args })
        }
      },
    )
  })


  afterEach(() => {
    vi.restoreAllMocks()
  })


  it("saveState posts a mini-app:rpc message with the state as args", () => {
    void host.saveState({ count: 5 })
    expect(posted).toHaveLength(1)
    expect(posted[0].method).toBe("saveState")
    expect(posted[0].args).toEqual({ count: 5 })
    expect(typeof posted[0].id).toBe("string")
  })


  it("resolves the saveState promise when the host replies with a result", async () => {
    const pending = host.saveState("anything")
    const id = posted[0].id
    handleHostMessage({ type: "mini-app:rpc-result", id, result: undefined })
    await expect(pending).resolves.toBeUndefined()
  })


  it("rejects the promise when the host replies with an error", async () => {
    const pending = host.saveState("anything")
    const id = posted[0].id
    handleHostMessage({ type: "mini-app:rpc-result", id, error: "db is on fire" })
    await expect(pending).rejects.toThrow("db is on fire")
  })


  it("correlates results by id when multiple calls are in flight", async () => {
    const a = host.saveState("first")
    const b = host.saveState("second")
    expect(posted).toHaveLength(2)
    // Reply to the *second* request first, then the first. Both promises
    // must resolve independently; no cross-talk.
    handleHostMessage({ type: "mini-app:rpc-result", id: posted[1].id, result: undefined })
    handleHostMessage({ type: "mini-app:rpc-result", id: posted[0].id, result: undefined })
    await Promise.all([a, b])
  })


  it("ignores results with an unknown id without crashing", () => {
    const handled = handleHostMessage({
      type: "mini-app:rpc-result",
      id: "nope-not-a-real-id",
      result: 1,
    })
    // The function reports handled=true (we recognize the message type)
    // but takes no action — nothing to leak.
    expect(handled).toBe(true)
  })


  it("ignores messages of unrelated types", () => {
    expect(handleHostMessage({ type: "something-else", id: "1" })).toBe(false)
    expect(handleHostMessage(null)).toBe(false)
    expect(handleHostMessage("garbage")).toBe(false)
  })


  it("toast carries message and optional level in args", async () => {
    void host.toast("hello", "error")
    expect(posted[0].method).toBe("toast")
    expect(posted[0].args).toEqual({ message: "hello", level: "error" })
  })


  it("host.initialState reflects setHostInitialState", () => {
    expect(host.initialState).toBeUndefined()
    setHostInitialState({ saved: 42 })
    expect(host.initialState).toEqual({ saved: 42 })
    setHostInitialState(null)
    expect(host.initialState).toBeNull()
  })


  it("assigns unique ids to consecutive requests", () => {
    void host.saveState("a")
    void host.saveState("b")
    void host.saveState("c")
    const ids = posted.map((p) => p.id)
    expect(new Set(ids).size).toBe(3)
  })
})
