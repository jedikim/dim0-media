/**
 * Reconnect supervisor for the offline-first coordinator.
 *
 * The coordinator + `ws-relay` are transport-focused; this owns the *timing*:
 * on an unexpected socket close it schedules a backoff retry (reusing the
 * legacy `computeBackoffMs`), resets on a successful welcome, gives up after
 * `maxAttempts`, and retries immediately when a backgrounded tab returns. It
 * drives the shared `CollabConnState` so the status pill works for both clients.
 *
 * Timer + state setter are injectable so the whole state machine is unit-tested
 * with fake timers, independent of any real socket.
 */
import {
  MAX_RECONNECT_ATTEMPTS,
  computeBackoffMs,
  setCollabConnState,
} from "@/features/board/harness/canvas/collab-reconnect"
import type { CollabConnState } from "@/features/board/harness/canvas/collab-reconnect"


// WS close codes that mean "don't retry".
const CLOSE_CLEAN = new Set([1000, 1001])
const CLOSE_ROOM_FULL = 4429


export type ReconnectSupervisorOptions = {
  /** Re-open the connection (the coordinator's `reconnect`). */
  reconnect: () => void
  maxAttempts?: number
  backoff?: (attempt: number) => number
  setState?: (s: CollabConnState) => void
}


export class ReconnectSupervisor {
  private readonly reconnect: () => void
  private readonly maxAttempts: number
  private readonly backoff: (attempt: number) => number
  private readonly setState: (s: CollabConnState) => void
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false


  constructor(opts: ReconnectSupervisorOptions) {
    this.reconnect = opts.reconnect
    this.maxAttempts = opts.maxAttempts ?? MAX_RECONNECT_ATTEMPTS
    this.backoff = opts.backoff ?? computeBackoffMs
    this.setState = opts.setState ?? setCollabConnState
  }


  /** The socket is opening (initial connect or a retry). */
  onConnecting(): void {
    if (!this.stopped) this.setState("connecting")
  }


  /** A welcome landed — the connection is healthy; reset the backoff. */
  onWelcome(): void {
    if (this.stopped) return
    this.attempt = 0
    this.clearTimer()
    this.setState("live")
  }


  /** The socket closed. Decide whether (and when) to retry. */
  onClose(code: number): void {
    if (this.stopped) return
    if (CLOSE_CLEAN.has(code)) {
      this.setState("idle")
      return
    }
    if (code === CLOSE_ROOM_FULL) {
      this.setState("room-full")
      return
    }
    this.schedule()
  }


  /** A backgrounded tab returned to the foreground — retry now if we're waiting. */
  retryNow(): void {
    if (this.stopped || this.timer === null) return
    this.clearTimer()
    this.attempt = 0
    this.setState("connecting")
    this.reconnect()
  }


  /** Tear down: cancel any pending retry and stop reacting to closes. */
  stop(): void {
    this.stopped = true
    this.clearTimer()
  }


  private schedule(): void {
    if (this.attempt >= this.maxAttempts) {
      this.setState("failed")
      return
    }
    const delay = this.backoff(this.attempt)
    this.attempt += 1
    this.setState("reconnecting")
    this.timer = setTimeout(() => {
      this.timer = null
      this.setState("connecting")
      this.reconnect()
    }, delay)
  }


  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
