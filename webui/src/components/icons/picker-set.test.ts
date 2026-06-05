import { describe, expect, it } from "vitest"
import {
  filterPickerCategories,
  ICON_COLOR_PRESETS,
  PICKER_CATEGORIES,
  PICKER_ICON_MAP,
  tokenizeIconName,
  type PickerCategory,
} from "./picker-set"


/**
 * Builds a tiny stand-in category list for filter tests so we don't
 * couple assertions to the full curated set (which can grow over time).
 */
const fixtureCategories: ReadonlyArray<PickerCategory> = [
  {
    id: "test-a",
    label: "Test A",
    icons: [
      { name: "MapPin", component: (() => null) as never },
      { name: "MapTrifold", component: (() => null) as never },
      { name: "Lightbulb", component: (() => null) as never },
    ],
  },
  {
    id: "test-b",
    label: "Test B",
    icons: [
      { name: "Pencil", component: (() => null) as never },
      { name: "PuzzlePiece", component: (() => null) as never },
    ],
  },
]


describe("tokenizeIconName", () => {
  it("splits PascalCase into lowercase words", () => {
    expect(tokenizeIconName("MapPin")).toEqual(["map", "pin"])
    expect(tokenizeIconName("ChartLineUp")).toEqual(["chart", "line", "up"])
  })

  it("keeps single-word names as a one-element array", () => {
    expect(tokenizeIconName("Lightbulb")).toEqual(["lightbulb"])
  })

  it("treats already-lowercase input as a single token", () => {
    expect(tokenizeIconName("rocket")).toEqual(["rocket"])
  })

  it("returns an empty array for the empty string", () => {
    expect(tokenizeIconName("")).toEqual([])
  })
})


describe("filterPickerCategories", () => {
  it("returns the input untouched for an empty query", () => {
    expect(filterPickerCategories(fixtureCategories, "")).toBe(fixtureCategories)
    expect(filterPickerCategories(fixtureCategories, "   ")).toBe(fixtureCategories)
  })

  it("matches a substring of the icon name (case-insensitive)", () => {
    const result = filterPickerCategories(fixtureCategories, "light")
    const names = result.flatMap((category) => category.icons.map((icon) => icon.name))

    expect(names).toEqual(["Lightbulb"])
  })

  it("matches the prefix of any tokenized word", () => {
    // 'pin' is not in 'MapPin' as the leading substring of the whole name,
    // but it is a prefix of the second token after splitting on case.
    const result = filterPickerCategories(fixtureCategories, "pin")
    const names = result.flatMap((category) => category.icons.map((icon) => icon.name))

    expect(names).toEqual(["MapPin"])
  })

  it("returns all categories but with empty icon lists when nothing matches", () => {
    const result = filterPickerCategories(fixtureCategories, "zzznope")

    expect(result).toHaveLength(fixtureCategories.length)
    expect(result.every((category) => category.icons.length === 0)).toBe(true)
  })

  it("preserves the category id/label of filtered categories", () => {
    const result = filterPickerCategories(fixtureCategories, "pencil")

    expect(result.map((category) => category.id)).toEqual(["test-a", "test-b"])
    expect(result.map((category) => category.label)).toEqual(["Test A", "Test B"])
  })

  it("does not mutate the input categories", () => {
    const before = fixtureCategories.map((category) => category.icons.length)
    filterPickerCategories(fixtureCategories, "pin")
    const after = fixtureCategories.map((category) => category.icons.length)

    expect(after).toEqual(before)
  })
})


describe("PICKER_CATEGORIES integrity", () => {
  it("has at least one icon in every category", () => {
    for (const category of PICKER_CATEGORIES) {
      expect(category.icons.length, `category ${category.id} is empty`).toBeGreaterThan(0)
    }
  })

  it("has unique category ids", () => {
    const ids = PICKER_CATEGORIES.map((category) => category.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it("has no duplicate icon names across the whole set", () => {
    const names = PICKER_CATEGORIES.flatMap((category) =>
      category.icons.map((icon) => icon.name),
    )

    expect(new Set(names).size).toBe(names.length)
  })

  it("attaches a defined component to every icon entry", () => {
    for (const category of PICKER_CATEGORIES) {
      for (const icon of category.icons) {
        expect(icon.component, `${icon.name} has no component`).toBeTruthy()
      }
    }
  })
})


describe("ICON_COLOR_PRESETS", () => {
  it("has at least 8 entries", () => {
    expect(ICON_COLOR_PRESETS.length).toBeGreaterThanOrEqual(8)
  })

  it("has unique ids", () => {
    const ids = ICON_COLOR_PRESETS.map((preset) => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it("opens with a 'default' preset backed by a CSS variable (theme-adapted)", () => {
    const first = ICON_COLOR_PRESETS[0]

    expect(first.id).toBe("default")
    expect(first.value).toMatch(/^var\(--/)
  })

  it("every preset has a label and a value (string or null)", () => {
    for (const preset of ICON_COLOR_PRESETS) {
      expect(preset.label, `${preset.id} missing label`).toBeTruthy()
      expect(
        preset.value === null || typeof preset.value === "string",
        `${preset.id} value must be string|null`,
      ).toBe(true)
    }
  })

  it("non-default presets use a valid 6-digit hex (paper-adapted Tailwind)", () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/

    for (const preset of ICON_COLOR_PRESETS) {
      if (preset.id === "default") continue
      expect(preset.value, `${preset.id} value missing`).toBeTruthy()
      expect(preset.value, `${preset.id} should be #xxxxxx, got ${preset.value}`).toMatch(hexPattern)
    }
  })
})


describe("PICKER_ICON_MAP", () => {
  it("contains exactly one entry per icon across all categories", () => {
    const totalIcons = PICKER_CATEGORIES.reduce(
      (sum, category) => sum + category.icons.length,
      0,
    )

    expect(PICKER_ICON_MAP.size).toBe(totalIcons)
  })

  it("maps each icon name to the same component the category entry holds", () => {
    for (const category of PICKER_CATEGORIES) {
      for (const icon of category.icons) {
        expect(PICKER_ICON_MAP.get(icon.name)).toBe(icon.component)
      }
    }
  })

  it("returns undefined for unknown names", () => {
    expect(PICKER_ICON_MAP.get("ThisIconDoesNotExist")).toBeUndefined()
  })
})
