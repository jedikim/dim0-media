import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReconnectSupervisor } from "./reconnect-supervisor"
import type { CollabConnState } from "@/features/board/harness/canvas/collab-reconnect"


const setup = () => {
  const reconnect = vi.fn()
  const states: CollabConnState[] = []
  const sup = new ReconnectSupervisor({
    reconnect,
    backoff: (attempt) => (attempt + 1) * 1000, // 1s, 2s, 3s — deterministic
    setState: (s) => states.push(s),
    maxAttempts: 3,
  })
  return { sup, reconnect, states }
}


describe("ReconnectSupervisor", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())


  it("retries with backoff after an unexpected close", () => {
    const { sup, reconnect } = setup()
    sup.onClose(1006)
    expect(reconnect).not.toHaveBeenCalled() // scheduled, not immediate
    vi.advanceTimersByTime(999)
    expect(reconnect).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(reconnect).toHaveBeenCalledTimes(1)
  })


  it("escalates the backoff each attempt", () => {
    const { sup, reconnect } = setup()
    sup.onClose(1006)
    vi.advanceTimersByTime(1000) // attempt 0 → 1s
    expect(reconnect).toHaveBeenCalledTimes(1)
    sup.onClose(1006)
    vi.advanceTimersByTime(1999) // attempt 1 → 2s
    expect(reconnect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(reconnect).toHaveBeenCalledTimes(2)
  })


  it("gives up after maxAttempts with a failed state", () => {
    const { sup, reconnect, states } = setup()
    for (let i = 0; i < 3; i++) {
      sup.onClose(1006)
      vi.advanceTimersByTime(10_000)
    }
    sup.onClose(1006) // 4th close — over the cap of 3
    expect(reconnect).toHaveBeenCalledTimes(3)
    expect(states.at(-1)).toBe("failed")
  })


  it("resets the backoff after a successful welcome", () => {
    const { sup, reconnect } = setup()
    sup.onClose(1006)
    vi.advanceTimersByTime(1000) // attempt 0
    sup.onWelcome() // healthy again → attempt resets to 0
    sup.onClose(1006)
    vi.advanceTimersByTime(1000) // back to the 1s (attempt 0) delay
    expect(reconnect).toHaveBeenCalledTimes(2)
  })


  it("does not retry on a clean close (1000)", () => {
    const { sup, reconnect, states } = setup()
    sup.onClose(1000)
    vi.advanceTimersByTime(60_000)
    expect(reconnect).not.toHaveBeenCalled()
    expect(states.at(-1)).toBe("idle")
  })


  it("does not retry when the room is full (4429)", () => {
    const { sup, reconnect, states } = setup()
    sup.onClose(4429)
    vi.advanceTimersByTime(60_000)
    expect(reconnect).not.toHaveBeenCalled()
    expect(states.at(-1)).toBe("room-full")
  })


  it("retryNow cancels the pending backoff and reconnects immediately", () => {
    const { sup, reconnect } = setup()
    sup.onClose(1006) // schedule a retry
    sup.retryNow() // tab foregrounded
    expect(reconnect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(reconnect).toHaveBeenCalledTimes(1) // the scheduled one was cancelled
  })


  it("retryNow is a no-op when nothing is pending", () => {
    const { sup, reconnect } = setup()
    sup.retryNow()
    expect(reconnect).not.toHaveBeenCalled()
  })


  it("stop cancels a pending retry and ignores further closes", () => {
    const { sup, reconnect } = setup()
    sup.onClose(1006)
    sup.stop()
    vi.advanceTimersByTime(60_000)
    expect(reconnect).not.toHaveBeenCalled()
    sup.onClose(1006) // ignored after stop
    vi.advanceTimersByTime(60_000)
    expect(reconnect).not.toHaveBeenCalled()
  })
})
