/**
 * Pure connection-state detector — owns the two-strike escalation and
 * the offline-recovery backoff. Built without any React imports so the
 * state machine can be exercised under a fake clock in tests.
 *
 * State machine
 * -------------
 *
 *   online           ── ping fails ──▶ offline
 *       ▲                                  │
 *       └──────── ping succeeds ───────────┘
 *
 * Triggers:
 *   - `noteFailure()` — caller observed an HTTP timeout / network error
 *     or a WS unexpected close. Kicks a single ping. If it fails, waits
 *     1s and pings again; two consecutive failures → `offline`.
 *   - `noteNetworkOffline()` / `noteNetworkOnline()` — wired to the
 *     `navigator.onLine` events. `offline` is set immediately; coming
 *     back online does NOT auto-recover — we still require a ping.
 *
 * While offline a backoff loop pings on a 1s → 2s → 4s → 8s → 15s
 * cadence (capped) until one succeeds.
 */


export type ConnectionStatus = "online" | "offline"


export type Clock = {
  setTimeout: (cb: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}


export type PingFn = () => Promise<boolean>


export type DetectorOptions = {
  clock?: Clock
  ping: PingFn
  /** Delay between the first and second strike. Default 1000ms. */
  secondStrikeDelayMs?: number
  /** Backoff schedule while offline, in ms. The last value repeats. */
  backoffScheduleMs?: number[]
}


const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000, 15000]


export class ConnectionDetector {
  private status: ConnectionStatus = "online"
  private readonly listeners = new Set<(s: ConnectionStatus) => void>()
  private readonly clock: Clock
  private readonly ping: PingFn
  private readonly secondStrikeDelayMs: number
  private readonly backoff: number[]

  /** Inflight or scheduled second-strike timer (`null` when none). */
  private secondStrikeTimer: unknown = null
  /** Inflight or scheduled recovery timer while offline. */
  private recoveryTimer: unknown = null
  /** Single-flight: a probe is currently in flight. */
  private probing = false
  /** How many consecutive failed pings have landed in `online`. */
  private strikes = 0
  /** Current step into the backoff schedule. */
  private backoffStep = 0

  constructor(opts: DetectorOptions) {
    this.clock = opts.clock ?? defaultClock
    this.ping = opts.ping
    this.secondStrikeDelayMs = opts.secondStrikeDelayMs ?? 1000
    this.backoff = opts.backoffScheduleMs ?? DEFAULT_BACKOFF
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  subscribe(cb: (s: ConnectionStatus) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /**
   * Observed-failure event. Schedules a ping if one isn't already
   * scheduled or in-flight. Called by apiFetch on HTTP errors and by
   * the WS adapter on unexpected close.
   */
  noteFailure(): void {
    if (this.status === "offline") return
    this.probeOnce()
  }

  /** `navigator.onLine` flipped to false — go offline immediately. */
  noteNetworkOffline(): void {
    if (this.status === "offline") return
    this.transitionTo("offline")
  }

  /** `navigator.onLine` flipped to true — do not auto-recover, ping instead. */
  noteNetworkOnline(): void {
    if (this.status === "online") return
    this.kickRecovery(0)
  }

  /** Disable timers; meant for unmount in tests. */
  dispose(): void {
    this.cancelTimer("secondStrikeTimer")
    this.cancelTimer("recoveryTimer")
    this.listeners.clear()
  }

  // --- private ---------------------------------------------------------

  private transitionTo(next: ConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    this.strikes = 0
    if (next === "online") {
      this.backoffStep = 0
      this.cancelTimer("recoveryTimer")
      this.cancelTimer("secondStrikeTimer")
    } else {
      this.cancelTimer("secondStrikeTimer")
      this.kickRecovery(this.backoff[0])
    }
    for (const cb of this.listeners) cb(next)
  }

  private probeOnce(): void {
    if (this.probing) return
    this.probing = true
    this.ping().then((ok) => {
      this.probing = false
      this.onProbeResult(ok)
    }, () => {
      this.probing = false
      this.onProbeResult(false)
    })
  }

  private onProbeResult(ok: boolean): void {
    if (this.status === "online") {
      if (ok) {
        this.strikes = 0
        return
      }
      this.strikes += 1
      if (this.strikes >= 2) {
        this.transitionTo("offline")
        return
      }
      this.cancelTimer("secondStrikeTimer")
      this.secondStrikeTimer = this.clock.setTimeout(() => {
        this.secondStrikeTimer = null
        this.probeOnce()
      }, this.secondStrikeDelayMs)
      return
    }
    // status === offline
    if (ok) {
      this.transitionTo("online")
      return
    }
    this.backoffStep = Math.min(this.backoffStep + 1, this.backoff.length - 1)
    this.kickRecovery(this.backoff[this.backoffStep])
  }

  private kickRecovery(delayMs: number): void {
    this.cancelTimer("recoveryTimer")
    this.recoveryTimer = this.clock.setTimeout(() => {
      this.recoveryTimer = null
      this.probeOnce()
    }, delayMs)
  }

  private cancelTimer(field: "secondStrikeTimer" | "recoveryTimer"): void {
    const handle = this[field]
    if (handle !== null) {
      this.clock.clearTimeout(handle)
      this[field] = null
    }
  }
}


const defaultClock: Clock = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}
