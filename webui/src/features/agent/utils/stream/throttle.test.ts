import { describe, expect, it } from "vitest"
import { createFlushGate, minIntervalForFps } from "./throttle"


describe("minIntervalForFps", () => {
  it("maps fps to a min interval, floored at 1ms", () => {
    expect(minIntervalForFps(10)).toBe(100)
    expect(minIntervalForFps(20)).toBe(50)
    expect(minIntervalForFps(10000)).toBe(1) // never 0
  })
})


describe("createFlushGate", () => {
  it("rate-limits to maxFps: a second flush within the interval is blocked", () => {
    const gate = createFlushGate({ maxFps: 10 }) // 100ms
    expect(gate.shouldFlush(100)).toBe(true) // 100ms elapsed since the 0 baseline
    gate.markFlushed(100)
    expect(gate.shouldFlush(150)).toBe(false) // 50ms < 100ms
    expect(gate.shouldFlush(200)).toBe(true) // 100ms ≥ interval
  })

  it("force bypasses the rate limit", () => {
    const gate = createFlushGate({ maxFps: 10 })
    gate.markFlushed(0)
    expect(gate.shouldFlush(10)).toBe(false)
    expect(gate.shouldFlush(10, { force: true })).toBe(true)
  })

  it("safety interval flushes even when not fps-due and force is false", () => {
    const gate = createFlushGate({ maxFps: 1000, safetyMaxIntervalMs: 1000 }) // 1ms fps interval
    gate.markFlushed(0)
    // 500ms: fps-due but no pending content → no flush
    expect(gate.shouldFlush(500, { hasPending: false })).toBe(false)
    // 1000ms: safety fires regardless of pending
    expect(gate.shouldFlush(1000, { hasPending: false })).toBe(true)
  })

  it("a time-due flush needs pending content (hasPending gates it)", () => {
    const gate = createFlushGate({ maxFps: 10 })
    gate.markFlushed(0)
    expect(gate.shouldFlush(150, { hasPending: false })).toBe(false)
    expect(gate.shouldFlush(150, { hasPending: true })).toBe(true)
  })

  it("markFlushed resets the interval clock", () => {
    const gate = createFlushGate({ maxFps: 10 })
    gate.markFlushed(0)
    expect(gate.shouldFlush(100)).toBe(true)
    gate.markFlushed(100)
    expect(gate.shouldFlush(150)).toBe(false) // only 50ms since the reset
  })
})
