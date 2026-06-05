import { describe, expect, it } from "vitest"
import type { BoardContentItem } from "./list-board-contents"
import { applyIconUpdateToBoardContents } from "./apply-icon-update-to-board-contents"


const baseItem = (overrides: Partial<BoardContentItem>): BoardContentItem => ({
  id: overrides.id ?? "n-1",
  label: overrides.label ?? "Note",
  kind: overrides.kind ?? "sheet",
  parentId: overrides.parentId ?? null,
  iconData: overrides.iconData,
})


describe("applyIconUpdateToBoardContents", () => {
  it("returns undefined unchanged so uncached queries are clean no-ops", () => {
    expect(applyIconUpdateToBoardContents(undefined, "n-1", null)).toBeUndefined()
  })

  it("returns the empty list unchanged", () => {
    const result = applyIconUpdateToBoardContents([], "n-1", null)

    expect(result).toEqual([])
  })

  it("replaces the matching item's iconData with the new phosphor variant", () => {
    const items = [
      baseItem({ id: "n-1", iconData: null }),
      baseItem({ id: "n-2", iconData: null }),
    ]

    const next = { type: "phosphor" as const, name: "Rocket", color: "#dc2626" }
    const result = applyIconUpdateToBoardContents(items, "n-1", next)

    expect(result?.[0].iconData).toEqual(next)
    expect(result?.[1].iconData).toBeNull()
  })

  it("clears the matching item's iconData when `next` is null (Remove path)", () => {
    const items = [
      baseItem({
        id: "n-1",
        iconData: { type: "phosphor", name: "Heart", color: "#dc2626" },
      }),
    ]

    const result = applyIconUpdateToBoardContents(items, "n-1", null)

    expect(result?.[0].iconData).toBeNull()
  })

  it("leaves non-matching items referentially identical (no spurious re-renders)", () => {
    const other = baseItem({ id: "n-2", iconData: null })
    const items = [baseItem({ id: "n-1", iconData: null }), other]

    const result = applyIconUpdateToBoardContents(items, "n-1", {
      type: "phosphor",
      name: "Star",
      color: null,
    })

    expect(result?.[1]).toBe(other)
  })

  it("does not mutate the input array or items", () => {
    const items: BoardContentItem[] = [
      baseItem({ id: "n-1", iconData: null }),
      baseItem({ id: "n-2", iconData: null }),
    ]

    const snapshot = items.map((item) => ({ ...item }))
    applyIconUpdateToBoardContents(items, "n-1", {
      type: "phosphor",
      name: "Bell",
      color: "#2563eb",
    })

    expect(items).toEqual(snapshot)
  })

  it("returns a new array when there is a match (cache subscribers re-run)", () => {
    const items = [baseItem({ id: "n-1", iconData: null })]
    const result = applyIconUpdateToBoardContents(items, "n-1", {
      type: "phosphor",
      name: "Cat",
      color: null,
    })

    expect(result).not.toBe(items)
  })

  it("no-ops when the nodeId is not found (returns a new list with same values)", () => {
    const items = [
      baseItem({ id: "n-1", iconData: null }),
      baseItem({ id: "n-2", iconData: null }),
    ]

    const result = applyIconUpdateToBoardContents(items, "missing-id", {
      type: "phosphor",
      name: "Sun",
      color: null,
    })

    expect(result).toEqual(items)
  })
})
