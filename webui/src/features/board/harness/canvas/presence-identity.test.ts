import { describe, expect, it } from "vitest"
import { buildLocalPresence, colorForId } from "./presence-identity"


describe("presence identity", () => {
  it("derives a stable color per id (same id → same color)", () => {
    expect(colorForId("user-1")).toBe(colorForId("user-1"))
    expect(colorForId("user-1")).not.toBe(colorForId("user-2"))
    expect(colorForId("x")).toMatch(/^hsl\(\d+ 70% 55%\)$/)
  })


  it("names from the email local-part, colors by user id", () => {
    const p = buildLocalPresence("ada@dim0.net", "u42", "client-abc")
    expect(p.name).toBe("ada")
    expect(p.color).toBe(colorForId("u42")) // user id, not clientId, when present
    expect(p.cursor).toBeNull()
    expect(p.selection).toEqual([])
  })


  it("falls back to clientId color and Anonymous name", () => {
    const p = buildLocalPresence("", null, "client-abc")
    expect(p.name).toBe("Anonymous")
    expect(p.color).toBe(colorForId("client-abc"))
  })
})
