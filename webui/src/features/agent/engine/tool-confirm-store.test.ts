import { beforeEach, describe, expect, it } from "vitest"
import { useToolConfirm } from "./tool-confirm-store"


beforeEach(() => useToolConfirm.setState({ pending: null }))


describe("useToolConfirm", () => {
  it("parks a request as pending and resolves true on allow", async () => {
    const p = useToolConfirm.getState().request({ name: "fetch", args: { url: "x" } })
    expect(useToolConfirm.getState().pending?.name).toBe("fetch")
    useToolConfirm.getState().resolve(true)
    expect(await p).toBe(true)
    expect(useToolConfirm.getState().pending).toBeNull()
  })

  it("resolves false on decline", async () => {
    const p = useToolConfirm.getState().request({ name: "fetch", args: {} })
    useToolConfirm.getState().resolve(false)
    expect(await p).toBe(false)
  })

  it("auto-declines a second request while one is pending (no clobber of the first)", async () => {
    const first = useToolConfirm.getState().request({ name: "fetch", args: { url: "a" } })
    const second = useToolConfirm.getState().request({ name: "code_interpreter", args: {} })
    expect(await second).toBe(false) // new request fails closed
    expect(useToolConfirm.getState().pending?.name).toBe("fetch") // first prompt untouched
    useToolConfirm.getState().resolve(true)
    expect(await first).toBe(true)
  })

  it("resolve() is a no-op when nothing is pending", () => {
    expect(() => useToolConfirm.getState().resolve(true)).not.toThrow()
  })
})
