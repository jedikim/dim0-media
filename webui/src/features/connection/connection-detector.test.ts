import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ConnectionDetector, type Clock } from "./connection-detector"


/**
 * Hand-rolled fake clock: timers don't run until `advance(ms)` is
 * called. Simpler than vitest fake timers for our case because we also
 * want fine-grained control over the order in which microtasks (the
 * ping promises) and timers resolve.
 */
class FakeClock implements Clock {
  private now = 0
  private timers: Array<{ id: number; due: number; cb: () => void }> = []
  private nextId = 1

  setTimeout(cb: () => void, ms: number): unknown {
    const id = this.nextId++
    this.timers.push({ id, due: this.now + ms, cb })
    return id
  }

  clearTimeout(handle: unknown): void {
    const id = handle as number
    this.timers = this.timers.filter((t) => t.id !== id)
  }

  /** Advance time and fire any due timers in due order. */
  async advance(ms: number): Promise<void> {
    // Drain microtasks queued before this advance. Critical: timers
    // scheduled by a still-pending ping `.then` must register against
    // the *old* `now`, otherwise we bump time past their `due`.
    for (let i = 0; i < 5; i += 1) await Promise.resolve()

    this.now += ms
    // Fixed-point loop: drain microtasks, fire due timers, repeat,
    // because a fired timer's body may resolve another promise.
    for (let safety = 0; safety < 100; safety += 1) {
      for (let i = 0; i < 5; i += 1) await Promise.resolve()

      const due = this.timers
        .filter((t) => t.due <= this.now)
        .sort((a, b) => a.due - b.due)
      if (due.length === 0) return
      this.timers = this.timers.filter((t) => t.due > this.now)
      for (const t of due) t.cb()
    }
  }
}


/**
 * Programmable ping — queue results in advance; `pull()` returns the
 * next queued value or defaults to `true`.
 */
const makePing = () => {
  const queue: boolean[] = []
  const calls: number[] = []
  let n = 0
  return {
    fn: () => {
      n += 1
      calls.push(Date.now())
      const v = queue.shift()
      return Promise.resolve(v ?? true)
    },
    enqueue: (...results: boolean[]) => queue.push(...results),
    callCount: () => n,
  }
}


describe("ConnectionDetector", () => {
  let clock: FakeClock
  let detector: ConnectionDetector

  beforeEach(() => {
    clock = new FakeClock()
  })

  afterEach(() => {
    detector?.dispose()
  })

  it("starts online and stays online on a single ping success", async () => {
    const ping = makePing()
    ping.enqueue(true)
    detector = new ConnectionDetector({ clock, ping: ping.fn })

    detector.noteFailure()
    await clock.advance(0)

    expect(ping.callCount()).toBe(1)
    expect(detector.getStatus()).toBe("online")
  })

  it("waits 1s between the two strikes before going offline", async () => {
    const ping = makePing()
    ping.enqueue(false, false)
    detector = new ConnectionDetector({ clock, ping: ping.fn })
    const statuses: string[] = []
    detector.subscribe((s) => statuses.push(s))

    detector.noteFailure()
    await clock.advance(0)

    // First ping resolved false; no transition yet — waiting on the
    // 1s second-strike timer.
    expect(detector.getStatus()).toBe("online")
    expect(ping.callCount()).toBe(1)

    // Less than 1s — still no second strike.
    await clock.advance(500)
    expect(ping.callCount()).toBe(1)
    expect(detector.getStatus()).toBe("online")

    // After 1s the second ping fires and we transition to offline.
    await clock.advance(500)
    expect(ping.callCount()).toBe(2)
    expect(detector.getStatus()).toBe("offline")
    expect(statuses).toEqual(["offline"])
  })

  it("a single ping success between strikes keeps us online", async () => {
    const ping = makePing()
    ping.enqueue(false, true)
    detector = new ConnectionDetector({ clock, ping: ping.fn })

    detector.noteFailure()
    await clock.advance(1000) // triggers second strike

    expect(ping.callCount()).toBe(2)
    expect(detector.getStatus()).toBe("online")
  })

  it("noteNetworkOffline transitions to offline immediately (no ping needed)", async () => {
    const ping = makePing()
    detector = new ConnectionDetector({ clock, ping: ping.fn })

    detector.noteNetworkOffline()

    expect(detector.getStatus()).toBe("offline")
    expect(ping.callCount()).toBe(0)
  })

  it("recovers to online when a backoff ping succeeds", async () => {
    const ping = makePing()
    // Two consecutive failures to enter offline, then a recovery success.
    ping.enqueue(false, false, true)
    detector = new ConnectionDetector({
      clock,
      ping: ping.fn,
      backoffScheduleMs: [1000, 2000, 4000],
    })

    detector.noteFailure()
    await clock.advance(1000) // second strike → offline
    expect(detector.getStatus()).toBe("offline")

    await clock.advance(1000) // first backoff tick fires the recovery ping
    expect(detector.getStatus()).toBe("online")
  })

  it("walks the backoff schedule on repeated failed probes", async () => {
    const ping = makePing()
    // 2 strikes to go offline, then several backoff fails.
    ping.enqueue(false, false, false, false, false)
    detector = new ConnectionDetector({
      clock,
      ping: ping.fn,
      backoffScheduleMs: [1000, 2000, 4000],
    })

    detector.noteFailure()
    await clock.advance(1000) // offline
    expect(ping.callCount()).toBe(2)

    await clock.advance(1000) // step 0 (1s)
    expect(ping.callCount()).toBe(3)

    await clock.advance(2000) // step 1 (2s)
    expect(ping.callCount()).toBe(4)

    await clock.advance(4000) // step 2 (4s, cap)
    expect(ping.callCount()).toBe(5)
  })

  it("noteFailure is a no-op while offline (backoff loop owns probes)", async () => {
    const ping = makePing()
    ping.enqueue(false, false)
    detector = new ConnectionDetector({
      clock,
      ping: ping.fn,
      backoffScheduleMs: [10000],
    })

    detector.noteFailure()
    await clock.advance(1000) // offline now
    expect(ping.callCount()).toBe(2)

    detector.noteFailure()
    detector.noteFailure()
    await clock.advance(0)
    // Still 2 — only the backoff loop probes from here.
    expect(ping.callCount()).toBe(2)
  })

  it("burst failures while online single-flight the probe", async () => {
    const ping = makePing()
    ping.enqueue(true)
    detector = new ConnectionDetector({ clock, ping: ping.fn })

    detector.noteFailure()
    detector.noteFailure()
    detector.noteFailure()
    await clock.advance(0)

    expect(ping.callCount()).toBe(1)
  })

  it("subscribers receive each transition exactly once", async () => {
    const ping = makePing()
    ping.enqueue(false, false, true)
    detector = new ConnectionDetector({
      clock,
      ping: ping.fn,
      backoffScheduleMs: [500],
    })
    const events: string[] = []
    detector.subscribe((s) => events.push(s))

    detector.noteFailure()
    await clock.advance(1000) // → offline
    await clock.advance(500)  // backoff → online

    expect(events).toEqual(["offline", "online"])
  })
})
