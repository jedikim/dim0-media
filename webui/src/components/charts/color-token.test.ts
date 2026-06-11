import { describe, expect, it } from "vitest"

import { defaultPaletteColor, resolveColor } from "./color-token"


describe("resolveColor", () => {
  describe("token names", () => {
    it("resolves chart-1 to var(--chart-1)", () => {
      expect(resolveColor("chart-1")).toBe("var(--chart-1)")
    })


    it("resolves chart-5 (last in palette) to var(--chart-5)", () => {
      expect(resolveColor("chart-5")).toBe("var(--chart-5)")
    })


    it("resolves primary to var(--primary)", () => {
      expect(resolveColor("primary")).toBe("var(--primary)")
    })


    it("resolves muted-foreground (hyphenated) to var(--muted-foreground)", () => {
      expect(resolveColor("muted-foreground")).toBe("var(--muted-foreground)")
    })


    it("resolves destructive to var(--destructive)", () => {
      expect(resolveColor("destructive")).toBe("var(--destructive)")
    })
  })


  describe("non-token colors pass through", () => {
    it("passes hex literal unchanged", () => {
      expect(resolveColor("#FF4500")).toBe("#FF4500")
    })


    it("passes rgb() function unchanged", () => {
      expect(resolveColor("rgb(255, 69, 0)")).toBe("rgb(255, 69, 0)")
    })


    it("passes hsl() function unchanged", () => {
      expect(resolveColor("hsl(200, 50%, 40%)")).toBe("hsl(200, 50%, 40%)")
    })


    it("passes CSS named colors unchanged", () => {
      expect(resolveColor("steelblue")).toBe("steelblue")
    })


    it("passes pre-resolved var(...) unchanged (no double-wrapping)", () => {
      expect(resolveColor("var(--chart-3)")).toBe("var(--chart-3)")
    })


    it("does NOT resolve unrecognized token-shaped names", () => {
      // Looks like a token (`bg-blue-500`) but isn't in our theme set.
      // Pass through so unknown classes/colors are surfaced as-is at render
      // time rather than silently becoming undefined CSS variables.
      expect(resolveColor("bg-blue-500")).toBe("bg-blue-500")
    })
  })


  describe("fallbacks", () => {
    it("undefined falls back to first palette color", () => {
      expect(resolveColor(undefined)).toBe("var(--chart-1)")
    })


    it("empty string falls back to first palette color", () => {
      expect(resolveColor("")).toBe("var(--chart-1)")
    })
  })
})


describe("defaultPaletteColor", () => {
  it("indexes 0..4 map to chart-1..chart-5", () => {
    expect(defaultPaletteColor(0)).toBe("var(--chart-1)")
    expect(defaultPaletteColor(1)).toBe("var(--chart-2)")
    expect(defaultPaletteColor(4)).toBe("var(--chart-5)")
  })


  it("indexes wrap modulo 5 to keep the palette consistent", () => {
    expect(defaultPaletteColor(5)).toBe("var(--chart-1)")
    expect(defaultPaletteColor(7)).toBe("var(--chart-3)")
    expect(defaultPaletteColor(12)).toBe("var(--chart-3)")
  })
})
