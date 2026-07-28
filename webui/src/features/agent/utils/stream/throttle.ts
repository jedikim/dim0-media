/**
 * Frame-rate flush gate for streamed updates — the schema-agnostic throttle
 * shared by both agent stacks: the legacy backend-agent stream builder
 * (`build.ts`) and the client engine's render loop.
 *
 * A fast token stream would otherwise repaint per token; this coalesces to
 * ~`maxFps`, while `safetyMaxIntervalMs` guarantees a quiet-but-changing stream
 * still updates within the window. Pure — `now` is injected — so it's fully
 * unit-testable without timers.
 */

export type FlushGateOptions = {
  /** Max repaints per second (default 10 → ~100ms min interval). */
  maxFps?: number
  /** Force a flush at least this often even below the fps threshold (default 1s). */
  safetyMaxIntervalMs?: number
}


/** Minimum ms between flushes for a given fps (≥ 1ms). */
export const minIntervalForFps = (maxFps: number): number =>
  Math.max(1, Math.floor(1000 / maxFps))


export type FlushGate = {
  /**
   * Whether to flush at `now`. `force` bypasses the rate limit (structural
   * changes / the final frame); `hasPending` gates a time-due flush on there
   * being buffered content (default true). The safety interval always flushes.
   */
  shouldFlush(now: number, opts?: { force?: boolean; hasPending?: boolean }): boolean
  /** Record that a flush happened at `now` (resets the interval clock). */
  markFlushed(now: number): void
  readonly minIntervalMs: number
}


export const createFlushGate = (opts: FlushGateOptions = {}): FlushGate => {
  const maxFps = opts.maxFps ?? 10
  const safetyMaxIntervalMs = opts.safetyMaxIntervalMs ?? 1000
  const minIntervalMs = minIntervalForFps(maxFps)
  let lastFlushAt = 0

  return {
    minIntervalMs,
    shouldFlush(now, { force = false, hasPending = true } = {}): boolean {
      const dueByTime = now - lastFlushAt >= minIntervalMs
      const hitSafety = now - lastFlushAt >= safetyMaxIntervalMs
      return force || hitSafety || (dueByTime && hasPending)
    },
    markFlushed(now): void {
      lastFlushAt = now
    },
  }
}
