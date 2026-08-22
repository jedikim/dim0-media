import { describe, expect, it } from "vitest"

import {
  canUseImageImports,
  canUseServerImageGeneration,
} from "../canvas/board-runtime-context"


describe("image generator toolbar availability", () => {
  it("shows the server-backed tool only on synced boards", () => {
    expect(canUseServerImageGeneration(false)).toBe(true)
    expect(canUseServerImageGeneration(true)).toBe(false)
  })


  it("hides image import and search chrome from viewers", () => {
    expect(canUseImageImports(false)).toBe(false)
    expect(canUseImageImports(true)).toBe(true)
  })
})
