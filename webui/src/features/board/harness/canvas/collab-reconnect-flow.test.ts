/**
 * Integration-style test for the reconnect state machine driven by
 * `useWsCollab`'s outer effect. The actual hook spins up a real
 * WebSocket connection which is impractical to mock fully — instead
 * this test exercises the same control-flow primitives (`setup`,
 * `scheduleReconnect`, `cancelReconnect`, visibility-change handler)
 * by replicating the structure with fake timers + a stub adapter that
 * lets us simulate `onWelcome` and `onClose` synchronously.
 *
 * What we're locking down:
 *  1. Unexpected close → backoff sequence is `1s, 2s, 4s, …` (matching
 *     `computeBackoffMs`).
 *  2. Welcome resets the attempt counter — a transient blip doesn't
 *     burn through the budget.
 *  3. `MAX_RECONNECT_ATTEMPTS` exhaustion → state transitions to
 *     `failed`, no more retries scheduled.
 *  4. Visibility change to `visible` while in `reconnecting` →
 *     cancels the current backoff and retries immediately.
 *  5. Clean close (code 1000) → no reconnect attempt.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import {
  MAX_RECONNECT_ATTEMPTS,
  computeBackoffMs,
  getCollabConnState,
  resetCollabConnState,
  setCollabConnState,
} from "./collab-reconnect"


/**
 * Mirror of the reconnect loop inside `useWsCollab`'s `useEffect`,
 * abstracted away from the real WebSocket + adapter. Driven by a
 * fake `adapterFactory` that exposes hooks to fire `onWelcome` and
 * `onClose` at test-controlled moments.
 */
type FakeAdapter = {
  fireWelcome: (seq: number) => void
  fireClose: (code: number, seqAtClose: number) => void
  teardownCalls: number
}


type RunHarnessOpts = {
  adapterFactory: (callbacks: {
    onWelcome: (seq: number) => void
    onClose: (code: number, seqAtClose: number) => void
    sinceSeq: number | null
  }) => FakeAdapter
}


const runHarness = (opts: RunHarnessOpts) => {
  let cancelled = false
  let teardown: (() => void) | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let lastSeq = 0
  const adapters: FakeAdapter[] = []
  setCollabConnState("connecting")

  const cancelReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = () => {
    if (cancelled) return
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      setCollabConnState("failed")
      return
    }
    const delay = computeBackoffMs(attempt)
    attempt += 1
    setCollabConnState("reconnecting")
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      setup()
    }, delay)
  }

  const setup = () => {
    if (cancelled) return
    setCollabConnState("connecting")
    const adapter = opts.adapterFactory({
      sinceSeq: lastSeq > 0 ? lastSeq : null,
      onWelcome: (seq) => {
        lastSeq = seq
        attempt = 0
        setCollabConnState("live")
      },
      onClose: (code, seqAtClose) => {
        lastSeq = seqAtClose
        teardown?.()
        teardown = null
        if (cancelled) return
        if (code === 1000 || code === 1001) return
        // Mirror the real loop: 4429 (room-full) terminates instead of retrying.
        if (code === 4429) {
          setCollabConnState("room-full")
          return
        }
        scheduleReconnect()
      },
    })
    adapters.push(adapter)
    teardown = () => {
      adapter.teardownCalls += 1
    }
  }

  const onVisibilityChange = (visible: boolean) => {
    if (!visible) return
    if (getCollabConnState() !== "reconnecting") return
    cancelReconnect()
    attempt = 0
    setup()
  }

  setup()

  return {
    adapters,
    cancel: () => {
      cancelled = true
      cancelReconnect()
      teardown?.()
      teardown = null
      resetCollabConnState()
    },
    onVisibilityChange,
    getLastSeq: () => lastSeq,
    getAttempt: () => attempt,
  }
}


/** Build a stub adapter the test controls — captures callbacks so the
 *  test can fire welcome / close on demand. */
const makeStubAdapterFactory = () => {
  const created: FakeAdapter[] = []
  const factory: RunHarnessOpts["adapterFactory"] = (callbacks) => {
    const adapter: FakeAdapter = {
      fireWelcome: callbacks.onWelcome.bind(null) as never,
      fireClose: callbacks.onClose.bind(null) as never,
      teardownCalls: 0,
    }
    adapter.fireWelcome = (seq) => callbacks.onWelcome(seq)
    adapter.fireClose = (code, seqAtClose) => callbacks.onClose(code, seqAtClose)
    created.push(adapter)
    return adapter
  }
  return { factory, created }
}


describe("reconnect harness", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCollabConnState()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetCollabConnState()
  })

  it("first connect → welcome → live (no reconnect scheduled)", () => {
    const { factory, created } = makeStubAdapterFactory()
    const h = runHarness({ adapterFactory: factory })
    expect(getCollabConnState()).toBe("connecting")

    created[0].fireWelcome(7)
    expect(getCollabConnState()).toBe("live")
    expect(h.getLastSeq()).toBe(7)
    expect(h.getAttempt()).toBe(0)

    // No pending timers — nothing scheduled.
    expect(vi.getTimerCount()).toBe(0)
    h.cancel()
  })

  it("unexpected close → backoff sequence is 1s, 2s, 4s, …", () => {
    const { factory, created } = makeStubAdapterFactory()
    const h = runHarness({ adapterFactory: factory })
    created[0].fireWelcome(1)

    // First failure: schedule reconnect with 1s delay (attempt 0).
    created[0].fireClose(4001, 1)
    expect(getCollabConnState()).toBe("reconnecting")
    expect(h.getAttempt()).toBe(1)

    vi.advanceTimersByTime(1_000)
    expect(created.length).toBe(2)
    expect(getCollabConnState()).toBe("connecting")

    // Second failure (no welcome yet, attempt counter NOT reset).
    created[1].fireClose(4001, 1)
    expect(h.getAttempt()).toBe(2)
    // Backoff for attempt=1 is 2s.
    vi.advanceTimersByTime(2_000)
    expect(created.length).toBe(3)

    created[2].fireClose(4001, 1)
    // Backoff for attempt=2 is 4s.
    vi.advanceTimersByTime(4_000)
    expect(created.length).toBe(4)

    h.cancel()
  })

  it("welcome after a transient drop resets the attempt counter", () => {
    const { factory, created } = makeStubAdapterFactory()
    const h = runHarness({ adapterFactory: factory })

    // Welcome → drop → reconnect → welcome.
    created[0].fireWelcome(1)
    created[0].fireClose(4001, 1)
    vi.advanceTimersByTime(1_000)
    created[1].fireWelcome(2)
    expect(h.getAttempt()).toBe(0)

    // Next drop should be a fresh 1s backoff, not 2s.
    created[1].fireClose(4001, 2)
    expect(h.getAttempt()).toBe(1)
    expect(vi.getTimerCount()).toBe(1)
    h.cancel()
  })

  it("after MAX_RECONNECT_ATTEMPTS failures, transitions to failed and stops", () => {
    const { factory, created } = makeStubAdapterFactory()
    const h = runHarness({ adapterFactory: factory })

    // Burn through every attempt without a single successful welcome.
    let prevAdapter = created[0]
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i += 1) {
      prevAdapter.fireClose(4001, 0)
      const delay = computeBackoffMs(i)
      vi.advanceTimersByTime(delay)
      prevAdapter = created[created.length - 1]
    }
    // One more failure with no budget left → failed, no more timers.
    prevAdapter.fireClose(4001, 0)
    expect(getCollabConnState()).toBe("failed")
    expect(vi.getTimerCount()).toBe(0)
    h.cancel()
  })

  it("clean close (code 1000) does not schedule a reconnect", () => {
    const { factory, created } = makeStubAdapterFactory()
    const h = runHarness({ adapterFactory: factory })
    created[0].fireWelcome(1)

    created[0].fireClose(1000, 1)
    // No timer scheduled, state did NOT switch to reconnecting.
    expect(getCollabConnState()).toBe("live")
    expect(vi.getTimerCount()).toBe(0)
    h.cancel()
  })

  it("room-full close (code 4429) terminates and does not schedule a reconnect", () => {
    // Server emits 4429 when the board is at its plan-tier concurrent-
    // user cap. Retrying won't help until someone leaves — the user
    // needs to refresh later — so the outer loop transitions to a
    // terminal "room-full" state and stops scheduling reconnects.
    const { factory, created } = makeStubAdapterFactory()
    const h = runHarness({ adapterFactory: factory })

    // No welcome — the server closes during accept with 4429.
    created[0].fireClose(4429, 0)
    expect(getCollabConnState()).toBe("room-full")
    expect(vi.getTimerCount()).toBe(0)
    // No new adapter was constructed (i.e. no reconnect attempt).
    expect(created.length).toBe(1)
    h.cancel()
  })

  it("visibility-change visible while reconnecting cancels backoff and retries immediately", () => {
    const { factory, created } = makeStubAdapterFactory()
    const h = runHarness({ adapterFactory: factory })
    created[0].fireWelcome(1)

    // Drop + still in backoff window.
    created[0].fireClose(4001, 1)
    expect(getCollabConnState()).toBe("reconnecting")
    expect(vi.getTimerCount()).toBe(1)

    // Tab comes back — should cancel timer + immediately call setup.
    h.onVisibilityChange(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(created.length).toBe(2)
    expect(getCollabConnState()).toBe("connecting")
    expect(h.getAttempt()).toBe(0)
    h.cancel()
  })

  it("visibility-change visible while live is a no-op", () => {
    const { factory, created } = makeStubAdapterFactory()
    const h = runHarness({ adapterFactory: factory })
    created[0].fireWelcome(1)

    h.onVisibilityChange(true)
    expect(getCollabConnState()).toBe("live")
    expect(created.length).toBe(1)
    h.cancel()
  })

  it("sinceSeq passes the highest observed seq across reconnect attempts", () => {
    const seenSinceSeqs: Array<number | null> = []
    const created: FakeAdapter[] = []

    const factory: RunHarnessOpts["adapterFactory"] = (callbacks) => {
      seenSinceSeqs.push(callbacks.sinceSeq)
      const adapter: FakeAdapter = {
        fireWelcome: (seq) => callbacks.onWelcome(seq),
        fireClose: (code, seqAtClose) => callbacks.onClose(code, seqAtClose),
        teardownCalls: 0,
      }
      created.push(adapter)
      return adapter
    }

    const h = runHarness({ adapterFactory: factory })

    // First adapter: sinceSeq=null (first connect).
    expect(seenSinceSeqs[seenSinceSeqs.length - 1]).toBeNull()

    created[0].fireWelcome(42)
    created[0].fireClose(4001, 42)
    vi.advanceTimersByTime(1_000)

    // Reconnect attempt: sinceSeq should be the last observed seq.
    expect(seenSinceSeqs[seenSinceSeqs.length - 1]).toBe(42)

    h.cancel()
  })
})
