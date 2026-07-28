import { describe, expect, it, vi } from "vitest"
import { asBatchId, asClientId } from "@canvas-harness/core"
import { createWebSocketRelay } from "./ws-relay"
import type { WebSocketLike } from "./ws-relay"
import type { InboundMessage } from "./wire"


/** A hand-driven WebSocket: capture sent frames, simulate open/message/close. */
class FakeSocket implements WebSocketLike {
  sent: string[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  closedWith: number | null = null


  send(data: string): void {
    this.sent.push(data)
  }

  close(code = 1000): void {
    this.closedWith = code
  }

  simulateOpen(): void {
    this.readyState = 1
    this.onopen?.()
  }

  simulateMessage(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }

  simulateClose(code = 1006): void {
    this.readyState = 3
    this.onclose?.({ code, reason: "" })
  }
}


/** Build a relay over a FakeSocket; returns the relay + a promise of the socket. */
const setup = (over: Partial<Parameters<typeof createWebSocketRelay>[0]> = {}) => {
  let socket: FakeSocket | null = null
  let capturedUrl = ""
  const relay = createWebSocketRelay({
    boardId: "b1",
    clientId: asClientId("A"),
    sinceSeq: 0,
    mintTicket: async () => "TICKET",
    wsUrl: (path) => `wss://relay.test${path}`,
    socketFactory: (url) => {
      capturedUrl = url
      socket = new FakeSocket()
      return socket
    },
    ...over,
  })
  // The socket opens after the async ticket mint resolves.
  return { relay, getSocket: () => socket, getUrl: () => capturedUrl }
}


const tick = () => new Promise((r) => setTimeout(r, 0))


describe("createWebSocketRelay", () => {
  it("mints a ticket and builds the URL with ticket, since_seq and proto=2", async () => {
    const s = setup({ sinceSeq: 42, rootId: "folder-1" })
    await tick()
    const url = s.getUrl()
    expect(url).toContain("/boards/b1/collab?")
    expect(url).toContain("ticket=TICKET")
    expect(url).toContain("since_seq=42")
    expect(url).toContain("proto=2")
    expect(url).toContain("root_id=folder-1")
  })


  it("omits since_seq on first connect (0) so the relay sends a snapshot", async () => {
    const s = setup({ sinceSeq: 0 })
    await tick()
    const url = s.getUrl()
    expect(url).toContain("proto=2")
    expect(url).not.toContain("since_seq")
  })


  it("buffers outbound frames until open, then flushes them", async () => {
    const s = setup()
    await tick()
    const socket = s.getSocket()!
    // Sent before OPEN → buffered.
    s.relay.send({ kind: "op", client_seq: 1, batch: { id: asBatchId("b"), clientId: asClientId("A"), ts: 0, origin: "local", ops: [] } })
    expect(socket.sent).toHaveLength(0)

    socket.simulateOpen()
    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0])).toMatchObject({ kind: "op", client_seq: 1 })
  })


  it("sends immediately once open", async () => {
    const s = setup()
    await tick()
    const socket = s.getSocket()!
    socket.simulateOpen()
    s.relay.send({ kind: "presence-leave", clientId: asClientId("A") })
    expect(JSON.parse(socket.sent[0])).toEqual({ kind: "presence-leave", clientId: "A" })
  })


  it("parses inbound frames into InboundMessage and dispatches to the listener", async () => {
    const s = setup()
    await tick()
    const socket = s.getSocket()!
    const got: InboundMessage[] = []
    s.relay.onMessage((m) => got.push(m))

    socket.simulateMessage({ kind: "welcome", mode: "catch-up", seq: 2, batches: [] })
    socket.simulateMessage({ kind: "peer-op", seq: 3, batch: { id: "x", clientId: "B", ts: 0, origin: "local", ops: [] } })
    socket.simulateMessage("not json{{")

    expect(got.map((m) => m.kind)).toEqual(["welcome", "peer-op"]) // malformed dropped
  })


  it("notifies onClose when the socket drops", async () => {
    const onClose = vi.fn()
    const s = setup({ onClose })
    await tick()
    s.getSocket()!.simulateClose(1006)
    expect(onClose).toHaveBeenCalledWith(1006)
  })


  it("does not fire onClose for a caller-initiated close", async () => {
    const onClose = vi.fn()
    const s = setup({ onClose })
    await tick()
    const socket = s.getSocket()!
    s.relay.close()
    expect(socket.closedWith).toBe(1000)
    socket.simulateClose(1000) // the close event that follows our close()
    expect(onClose).not.toHaveBeenCalled()
  })


  it("fires onClose when the ticket mint fails", async () => {
    const onClose = vi.fn()
    setup({ onClose, mintTicket: async () => { throw new Error("no ticket") } })
    await tick()
    expect(onClose).toHaveBeenCalledWith(0)
  })
})
