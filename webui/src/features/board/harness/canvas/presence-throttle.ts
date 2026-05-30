/**
 * Leading + trailing-edge throttle for outbound presence frames.
 *
 * Cursors fire on every pointermove (~60Hz); broadcasting them all-to-all
 * is N² over peer count. Throttle to ~20Hz: the first frame goes out
 * immediately (peers see the cursor pop in), subsequent frames within
 * the window are coalesced and the final one fires at the window
 * boundary (a stopping cursor still lands its final position).
 *
 * Pure timer-driven logic, no WS or canvas-harness dependencies — keeps
 * the unit test trivial with `vi.useFakeTimers`.
 */
export type PresenceThrottle<T> = {
  /** Queue `state` for outbound. May fire `flush` synchronously (leading edge). */
  push(state: T): void
  /** Force any pending state out and clear the timer. Used on adapter teardown. */
  cancel(): void
}


/**
 * Build a throttle bound to `flush`. The clock defaults to `Date.now()` /
 * `setTimeout` (real time), but tests inject `vi.useFakeTimers()` to
 * step the clock deterministically.
 */
export const createPresenceThrottle = <T>(
  flush: (state: T) => void,
  opts: { windowMs?: number } = {},
): PresenceThrottle<T> => {
  const windowMs = opts.windowMs ?? 50

  let pending: T | null = null
  let lastSentAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const emit = () => {
    timer = null
    if (pending === null) return
    const toSend = pending
    pending = null
    lastSentAt = Date.now()
    flush(toSend)
  }

  return {
    push(state: T) {
      pending = state
      const elapsed = Date.now() - lastSentAt
      if (elapsed >= windowMs) {
        emit()
      } else if (timer === null) {
        timer = setTimeout(emit, windowMs - elapsed)
      }
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
    },
  }
}
