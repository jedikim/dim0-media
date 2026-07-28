import { describe, expect, it } from "vitest"
import { estimateNoteSize } from "./note-size"


describe("estimateNoteSize", () => {
  it("returns null for fixed-size types", () => {
    expect(estimateNoteSize("sheet", 440, "hello")).toBeNull()
    expect(estimateNoteSize("mini-app", 720, "x")).toBeNull()
  })


  it("returns null for empty content", () => {
    expect(estimateNoteSize("rect", 320, "   ")).toBeNull()
  })


  it("grows height for long content, clamps width to default", () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i} with some words`).join("\n")
    const size = estimateNoteSize("rect", 320, long)
    expect(size).not.toBeNull()
    expect(size!.width).toBeLessThanOrEqual(320)
    expect(size!.width).toBeGreaterThanOrEqual(120)
    expect(size!.height).toBeGreaterThan(180) // taller than the default box
  })


  it("keeps a short note compact", () => {
    const size = estimateNoteSize("rect", 320, "Cats")
    expect(size!.width).toBeLessThan(320)
    expect(size!.height).toBeLessThan(120)
  })


  it("enforces a square-ish aspect for diamonds", () => {
    const size = estimateNoteSize("diamond", 340, "short")!
    expect(size.height).toBeGreaterThanOrEqual(size.width)
  })
})
