/**
 * Sync wire protocol — the transport-agnostic contract between a client and the
 * relay. A `RelayConnection` is anything that can carry these messages: the
 * in-memory relay (tests) and the real WebSocket (E1.5) both implement it, so the
 * sync coordinator is written once and runs against either.
 *
 * A focused subset of the production protocol (enough for offline convergence);
 * snapshot-in-welcome, presence-leave and kick land with the real transport.
 */
import type { ClientId, OpBatch, PresenceState, Unsubscribe } from "@canvas-harness/core"


export type OutboundMessage =
  | { kind: "op"; client_seq: number; batch: OpBatch }
  | { kind: "hello"; clientId: ClientId }
  | { kind: "presence"; clientId: ClientId; state: PresenceState }
  | { kind: "presence-leave"; clientId: ClientId }


/** A relay-sequenced batch (its position in the shared total order). */
export type SeqBatch = { seq: number; batch: OpBatch }


/**
 * The welcome handshake. `since_seq` is sent at connect time (a query param on
 * the real WS), so the relay picks the mode:
 *   - `snapshot`: first connect (or a drift past the log) → full board payload
 *     to hydrate the local replica; the coordinator hands `snapshot` to its
 *     hydration hook (the shape is transport-specific, opaque here).
 *   - `catch-up`: reconnect within the log → the missed batches, each carrying
 *     its relay `seq` for serverSeq-ordered replay.
 *   - `live`: already current → no payload.
 */
export type WelcomeMessage =
  | { kind: "welcome"; mode: "snapshot"; seq: number; snapshot: unknown; presence?: Record<string, PresenceState> }
  | { kind: "welcome"; mode: "catch-up"; seq: number; batches: SeqBatch[] }
  | { kind: "welcome"; mode: "live"; seq: number }


export type InboundMessage =
  | WelcomeMessage
  | { kind: "peer-op"; seq: number; batch: OpBatch }
  | { kind: "op-applied"; seq: number; client_seq: number }
  | { kind: "op-rejected"; client_seq: number; reason?: string }
  | { kind: "presence"; clientId: ClientId; state: PresenceState }
  | { kind: "presence-leave"; clientId: ClientId }
  | { kind: "kick"; reason?: string }


/** A live connection to the relay for one board. */
export interface RelayConnection {
  send(msg: OutboundMessage): void
  onMessage(cb: (msg: InboundMessage) => void): Unsubscribe
  close(): void
}
