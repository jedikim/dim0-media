import { describe, expect, it } from "vitest"
import type { BoardContentItem } from "./list-board-contents"
import { applyTitleUpdateToBoardContents } from "./apply-title-update-to-board-contents"


const baseItem = (overrides: Partial<BoardContentItem>): BoardContentItem => ({
  id: overrides.id ?? "n-1",
  label: overrides.label ?? "Note",
  kind: overrides.kind ?? "sheet",
  parentId: overrides.parentId ?? null,
  iconData: overrides.iconData,
})


describe("applyTitleUpdateToBoardContents", () => {
  it("returns undefined unchanged so uncached queries are clean no-ops", () => {
    expect(applyTitleUpdateToBoardContents(undefined, "n-1", "x")).toBeUndefined()
  })

  it("returns the empty list unchanged", () => {
    expect(applyTitleUpdateToBoardContents([], "n-1", "x")).toEqual([])
  })

  it("replaces the matching item's label (the rename fix)", () => {
    const items = [
      baseItem({ id: "n-1", label: "Old" }),
      baseItem({ id: "n-2", label: "Other" }),
    ]

    const result = applyTitleUpdateToBoardContents(items, "n-1", "Renamed")

    expect(result?.[0].label).toBe("Renamed")
    expect(result?.[1].label).toBe("Other")
  })

  it("clears the matching item's label when given null (falls back to Untitled in the view)", () => {
    const items = [baseItem({ id: "n-1", label: "Old" })]

    const result = applyTitleUpdateToBoardContents(items, "n-1", null)

    expect(result?.[0].label).toBeNull()
  })

  it("leaves non-matching items referentially identical (no spurious re-renders)", () => {
    const other = baseItem({ id: "n-2", label: "Other" })
    const items = [baseItem({ id: "n-1", label: "Old" }), other]

    const result = applyTitleUpdateToBoardContents(items, "n-1", "Renamed")

    expect(result?.[1]).toBe(other)
  })

  it("does not mutate the input array or items", () => {
    const items: BoardContentItem[] = [
      baseItem({ id: "n-1", label: "Old" }),
      baseItem({ id: "n-2", label: "Other" }),
    ]
    const snapshot = items.map((item) => ({ ...item }))

    applyTitleUpdateToBoardContents(items, "n-1", "Renamed")

    expect(items).toEqual(snapshot)
  })

  it("returns a new array when there is a match (cache subscribers re-run)", () => {
    const items = [baseItem({ id: "n-1", label: "Old" })]

    expect(applyTitleUpdateToBoardContents(items, "n-1", "Renamed")).not.toBe(items)
  })

  it("no-ops when the nodeId is not found (returns a list with same values)", () => {
    const items = [
      baseItem({ id: "n-1", label: "A" }),
      baseItem({ id: "n-2", label: "B" }),
    ]

    expect(applyTitleUpdateToBoardContents(items, "missing-id", "x")).toEqual(items)
  })
})
