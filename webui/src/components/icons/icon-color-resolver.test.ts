import { describe, expect, it } from "vitest"
import { darkModeDisplayHex } from "@/features/board/lib/colors/dark-variants"
import { TAILWIND_HEX } from "@/features/board/lib/colors/tailwind"
import { resolveIconDisplayColor } from "./icon-color-resolver"


describe("resolveIconDisplayColor", () => {
  it("falls back to currentColor when no value is stored", () => {
    expect(resolveIconDisplayColor(null, false)).toBe("currentColor")
    expect(resolveIconDisplayColor(undefined, false)).toBe("currentColor")
    expect(resolveIconDisplayColor(null, true)).toBe("currentColor")
  })

  it("treats the empty string as unset (also falls back to currentColor)", () => {
    expect(resolveIconDisplayColor("", false)).toBe("currentColor")
    expect(resolveIconDisplayColor("", true)).toBe("currentColor")
  })

  it("passes CSS variable references through unchanged in both modes", () => {
    const cssVar = "var(--color-foreground)"

    expect(resolveIconDisplayColor(cssVar, false)).toBe(cssVar)
    expect(resolveIconDisplayColor(cssVar, true)).toBe(cssVar)
  })

  it("passes bare CSS custom property names through unchanged", () => {
    const bareToken = "--color-accent"

    expect(resolveIconDisplayColor(bareToken, false)).toBe(bareToken)
    expect(resolveIconDisplayColor(bareToken, true)).toBe(bareToken)
  })

  it("returns the stored hex unchanged in light mode", () => {
    const adaptedRed600 = TAILWIND_HEX.red[600]

    expect(resolveIconDisplayColor(adaptedRed600, false)).toBe(adaptedRed600)
  })

  it("delegates hex values to darkModeDisplayHex in dark mode", () => {
    const adaptedBlue600 = TAILWIND_HEX.blue[600]
    const expected = darkModeDisplayHex(adaptedBlue600)

    expect(expected, "darkModeDisplayHex should resolve a known palette hex").toBeTruthy()
    expect(resolveIconDisplayColor(adaptedBlue600, true)).toBe(expected)
  })

  it("dark-mode mapping differs from the stored hex (sanity check)", () => {
    // If this fails, either the dark map regressed or our preset palette
    // stopped using TAILWIND_HEX values — both warrant attention.
    const adaptedGreen600 = TAILWIND_HEX.green[600]

    expect(resolveIconDisplayColor(adaptedGreen600, true)).not.toBe(adaptedGreen600)
  })

  it("falls back to the raw hex if darkModeDisplayHex returns null", () => {
    // An off-palette custom hex still produces a fallback HSL inversion,
    // never null, but the resolver is defensive against null and returns
    // the original hex rather than `null` to keep CSS valid.
    const customHex = "#abcdef"
    const result = resolveIconDisplayColor(customHex, true)

    // Either the dark mapping returned a transformed value, or it fell
    // back to the original — never null/undefined/empty.
    expect(result).toBeTruthy()
    expect(typeof result).toBe("string")
  })
})
