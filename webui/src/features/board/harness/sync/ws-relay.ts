/**
 * WebSocket transport for the sync coordinator — a `RelayConnection` over a real
 * socket. The coordinator is transport-agnostic; this is the production sibling
 * of the in-memory relay used in tests.
 *
 * `connect(sinceSeq)` is synchronous, but opening a socket isn't: we mint a
 * one-shot ticket, build the URL, then open. Outbound frames sent before the
 * socket is OPEN are buffered and flushed on open (same pattern as the legacy
 * client). `since_seq` + `proto=2` ride in the URL query so the relay picks the
 * welcome mode and tags catch-up batches with their seq.
 *
 * The socket is injectable (`socketFactory`) so the whole thing is exercised
 * deterministically against a fake WebSocket, no server required.
 */
import type { ClientId } from "@canvas-harness/core"
import type { InboundMessage, OutboundMessage, RelayConnection } from "./wire"


const WS_OPEN = 1


/** Minimal socket surface — the browser `WebSocket` satisfies it; tests fake it. */
export interface WebSocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  readyState: number
  onopen: (() => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}


export type WebSocketRelayOptions = {
  boardId: string
  clientId: ClientId
  /** Highest relay seq seen — drives the welcome mode (query param). */
  sinceSeq: number
  /** Folder scope for the welcome snapshot (optional). */
  rootId?: string
  /** Mint a one-shot collab ticket for a board (reuses the existing REST call). */
  mintTicket: (boardId: string) => Promise<string>
  /** Build an absolute ws(s):// URL from a path (host/scheme conversion). */
  wsUrl: (path: string) => string
  /** Notified when the socket closes (so a supervisor can reconnect). */
  onClose?: (code: number) => void
  /** Override socket construction (default: `new WebSocket(url)`); for tests. */
  socketFactory?: (url: string) => WebSocketLike
}


/** Parse an inbound frame into an InboundMessage, or null if malformed. */
const parseInbound = (data: string): InboundMessage | null => {
  try {
    const msg = JSON.parse(data)
    return msg && typeof msg.kind === "string" ? (msg as InboundMessage) : null
  } catch {
    return null
  }
}


/** Open a WebSocket-backed RelayConnection for one board session. */
export const createWebSocketRelay = (opts: WebSocketRelayOptions): RelayConnection => {
  let socket: WebSocketLike | null = null
  let listener: ((m: InboundMessage) => void) | null = null
  let closed = false
  const outbox: string[] = []

  const flush = (): void => {
    if (!socket || socket.readyState !== WS_OPEN) return
    for (const raw of outbox.splice(0)) socket.send(raw)
  }

  const open = async (): Promise<void> => {
    let ticket: string
    try {
      ticket = await opts.mintTicket(opts.boardId)
    } catch {
      opts.onClose?.(0) // ticket mint failed — let the supervisor retry
      return
    }
    if (closed) return
    const params = new URLSearchParams({ ticket, proto: "2" })
    // Omit since_seq on first connect (0) so the relay sends a full snapshot —
    // an existing board's base state lives in the factory, not the oplog from
    // genesis. A positive cursor means reconnect → catch-up from there.
    if (opts.sinceSeq > 0) params.set("since_seq", String(opts.sinceSeq))
    if (opts.rootId) params.set("root_id", opts.rootId)
    const url = opts.wsUrl(`/boards/${opts.boardId}/collab?${params.toString()}`)
    const s = opts.socketFactory
      ? opts.socketFactory(url)
      : (new WebSocket(url) as unknown as WebSocketLike)
    socket = s
    s.onopen = () => flush()
    s.onmessage = (ev) => {
      const msg = parseInbound(ev.data)
      if (msg && listener) listener(msg)
    }
    s.onclose = (ev) => {
      socket = null
      if (!closed) opts.onClose?.(ev.code)
    }
    s.onerror = () => {}
  }

  void open()

  return {
    send: (msg: OutboundMessage) => {
      outbox.push(JSON.stringify(msg)) // OutboundMessage is already wire-shaped
      flush()
    },
    onMessage: (cb) => {
      listener = cb
      return () => {
        if (listener === cb) listener = null
      }
    },
    close: () => {
      closed = true
      socket?.close(1000)
      socket = null
    },
  }
}
