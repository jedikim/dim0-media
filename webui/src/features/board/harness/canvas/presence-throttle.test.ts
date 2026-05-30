import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPresenceThrottle } from "./presence-throttle"


describe("createPresenceThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("fires the first push synchronously (leading edge)", () => {
    const flushes: number[] = []
    const t = createPresenceThrottle<number>((v) => flushes.push(v), { windowMs: 50 })

    t.push(1)
    expect(flushes).toEqual([1])
  })

  it("coalesces bursts inside the window into one trailing-edge flush", () => {
    const flushes: number[] = []
    const t = createPresenceThrottle<number>((v) => flushes.push(v), { windowMs: 50 })

    t.push(1)       // leading
    t.push(2)
    t.push(3)
    t.push(4)
    expect(flushes).toEqual([1])

    vi.advanceTimersByTime(49)
    expect(flushes).toEqual([1])

    vi.advanceTimersByTime(1)
    // Trailing edge fires the most recent buffered value.
    expect(flushes).toEqual([1, 4])
  })

  it("a fresh push after the window fires leading-edge again", () => {
    const flushes: number[] = []
    const t = createPresenceThrottle<number>((v) => flushes.push(v), { windowMs: 50 })

    t.push(1)
    vi.advanceTimersByTime(100)
    t.push(2)
    expect(flushes).toEqual([1, 2])
  })

  it("cancel drops pending state without firing the trailing flush", () => {
    const flushes: number[] = []
    const t = createPresenceThrottle<number>((v) => flushes.push(v), { windowMs: 50 })

    t.push(1)
    t.push(2)
    t.cancel()
    vi.advanceTimersByTime(100)
    // Only the leading-edge "1" fired; "2" was cancelled.
    expect(flushes).toEqual([1])
  })

  it("default window is 50ms when not overridden", () => {
    const flushes: number[] = []
    const t = createPresenceThrottle<number>((v) => flushes.push(v))

    t.push(1)
    t.push(2)
    vi.advanceTimersByTime(49)
    expect(flushes).toEqual([1])
    vi.advanceTimersByTime(1)
    expect(flushes).toEqual([1, 2])
  })

  it("at 20Hz (50ms window) a 60Hz burst lands as ~20 sent frames", () => {
    // Simulates a 1s cursor drag at 60fps. Without the throttle the
    // peer would see 60 frames; with the throttle they get 20 — the
    // designed N² reduction in fan-out load.
    const flushes: number[] = []
    const t = createPresenceThrottle<number>((v) => flushes.push(v), { windowMs: 50 })

    let frame = 0
    for (let elapsed = 0; elapsed < 1_000; elapsed += 16) {
      t.push(frame++)
      vi.advanceTimersByTime(16)
    }
    // Wait out the final trailing window.
    vi.advanceTimersByTime(50)

    // Leading + 19 trailing windows = ~20-21 sends (jitter on the
    // boundary). Strict check: 18 ≤ count ≤ 22 covers the boundary
    // wiggle without locking down timer math too tightly.
    expect(flushes.length).toBeGreaterThanOrEqual(18)
    expect(flushes.length).toBeLessThanOrEqual(22)
  })
})
