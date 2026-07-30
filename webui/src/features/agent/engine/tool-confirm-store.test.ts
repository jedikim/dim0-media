import { beforeEach, describe, expect, it, vi } from "vitest"
import { resolveConfirmDecision, useToolConfirm } from "./tool-confirm-store"


beforeEach(() => useToolConfirm.setState({ pending: null }))


describe("useToolConfirm", () => {
  it("parks a request as pending and resolves the decision on allow-once", async () => {
    const p = useToolConfirm.getState().request({ name: "fetch", args: { url: "x" } })
    expect(useToolConfirm.getState().pending?.name).toBe("fetch")
    useToolConfirm.getState().resolve("once")
    expect(await p).toBe("once")
    expect(useToolConfirm.getState().pending).toBeNull()
  })

  it("carries the 'always' decision through", async () => {
    const p = useToolConfirm.getState().request({ name: "web_search", args: {} })
    useToolConfirm.getState().resolve("always")
    expect(await p).toBe("always")
  })

  it("resolves 'deny' on decline", async () => {
    const p = useToolConfirm.getState().request({ name: "fetch", args: {} })
    useToolConfirm.getState().resolve("deny")
    expect(await p).toBe("deny")
  })

  it("auto-denies a second request while one is pending (no clobber of the first)", async () => {
    const first = useToolConfirm.getState().request({ name: "fetch", args: { url: "a" } })
    const second = useToolConfirm.getState().request({ name: "code_interpreter", args: {} })
    expect(await second).toBe("deny") // new request fails closed
    expect(useToolConfirm.getState().pending?.name).toBe("fetch") // first prompt untouched
    useToolConfirm.getState().resolve("once")
    expect(await first).toBe("once")
  })

  it("resolve() is a no-op when nothing is pending", () => {
    expect(() => useToolConfirm.getState().resolve("once")).not.toThrow()
  })
})


describe("resolveConfirmDecision", () => {
  it("short-circuits a granted tool to 'once' WITHOUT opening the dialog", async () => {
    const askDialog = vi.fn<() => Promise<"deny" | "once" | "always">>()
    const decision = await resolveConfirmDecision("web_search", () => true, askDialog)
    expect(decision).toBe("once") // not "always" — so it's re-checked every call (revocable mid-run)
    expect(askDialog).not.toHaveBeenCalled()
  })

  it("defers to the dialog for a non-granted tool and returns its decision", async () => {
    const askDialog = vi.fn(async () => "always" as const)
    const decision = await resolveConfirmDecision("fetch", () => false, askDialog)
    expect(askDialog).toHaveBeenCalledTimes(1)
    expect(decision).toBe("always")
  })

  it("checks the grant per tool name (only the granted tool skips the prompt)", async () => {
    const isAllowed = (t: string) => t === "web_search"
    const ask = vi.fn(async () => "deny" as const)
    expect(await resolveConfirmDecision("web_search", isAllowed, ask)).toBe("once")
    expect(await resolveConfirmDecision("code_interpreter", isAllowed, ask)).toBe("deny")
    expect(ask).toHaveBeenCalledTimes(1) // only the non-granted tool asked
  })
})
