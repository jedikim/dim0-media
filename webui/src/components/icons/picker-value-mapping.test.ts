import { describe, expect, it } from "vitest"
import { iconToPickerValue, pickerValueToIcon } from "./picker-value-mapping"


describe("iconToPickerValue", () => {
  it("returns null when no icon is set", () => {
    expect(iconToPickerValue(null)).toBeNull()
    expect(iconToPickerValue(undefined)).toBeNull()
  })

  it("maps a phosphor variant with a hex color", () => {
    const result = iconToPickerValue({
      type: "phosphor",
      name: "Lightbulb",
      color: "#dc2626",
    })

    expect(result).toEqual({ name: "Lightbulb", color: "#dc2626" })
  })

  it("maps a phosphor variant with a CSS variable color", () => {
    const result = iconToPickerValue({
      type: "phosphor",
      name: "Heart",
      color: "var(--color-foreground)",
    })

    expect(result).toEqual({ name: "Heart", color: "var(--color-foreground)" })
  })

  it("normalizes absent color to null (not undefined)", () => {
    const result = iconToPickerValue({ type: "phosphor", name: "Star" })

    expect(result).toEqual({ name: "Star", color: null })
  })

  it("returns null for the emoji variant (picker only edits phosphor)", () => {
    expect(iconToPickerValue({ type: "emoji", emoji: "🚀" })).toBeNull()
  })

  it("returns null for the iconify URL variant (used by icon-nodes, not the picker)", () => {
    expect(
      iconToPickerValue({ type: "icon", icon: "https://api.iconify.design/lucide/home.svg" }),
    ).toBeNull()
  })
})


describe("pickerValueToIcon", () => {
  it("produces a phosphor variant carrying name and color", () => {
    expect(pickerValueToIcon({ name: "Lightbulb", color: "#dc2626" })).toEqual({
      type: "phosphor",
      name: "Lightbulb",
      color: "#dc2626",
    })
  })

  it("preserves a null color (default / theme foreground)", () => {
    expect(pickerValueToIcon({ name: "Heart", color: null })).toEqual({
      type: "phosphor",
      name: "Heart",
      color: null,
    })
  })

  it("preserves a CSS-variable color string", () => {
    expect(pickerValueToIcon({ name: "Star", color: "var(--color-foreground)" })).toEqual({
      type: "phosphor",
      name: "Star",
      color: "var(--color-foreground)",
    })
  })

  it("round-trips a phosphor selection through both mappings", () => {
    const original = { type: "phosphor" as const, name: "Rocket", color: "#2563eb" }
    const picker = iconToPickerValue(original)
    expect(picker).not.toBeNull()
    if (picker === null) return
    expect(pickerValueToIcon(picker)).toEqual(original)
  })
})
