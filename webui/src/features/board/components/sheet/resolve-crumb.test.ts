import { describe, expect, it } from "vitest"
import type { IconProperty } from "@/features/newsfeed/types/properties"
import { UNTITLED_LABEL } from "../../const"
import { createDefaultNote, type Note } from "../../types/note"
import { resolveCrumb, type CrumbNodeData } from "./resolve-crumb"


type IconValue = NonNullable<IconProperty["icon"]>

const CROWN: IconValue = { type: "phosphor", name: "Crown", color: null }
const FIRE: IconValue = { type: "emoji", emoji: "🔥" }


/** Build a minimal path-query Note with an optional label / custom icon. */
function pathNote(opts: { label?: string; icon?: IconValue }): Note {
  const note = createDefaultNote({ boardId: "b", nodeType: "sheet" })
  if (opts.label !== undefined) note.label = { markdown: opts.label }
  if (opts.icon !== undefined) note.properties.iconData = { type: "icon", icon: opts.icon }
  return note
}


/** Build the live canvas-store `data` slice with an optional label / icon. */
function liveData(opts: { label?: string; icon?: IconValue }): CrumbNodeData {
  return {
    label: opts.label !== undefined ? { markdown: opts.label } : undefined,
    properties: opts.icon !== undefined ? { iconData: { type: "icon", icon: opts.icon } } : undefined,
  }
}


describe("resolveCrumb — title", () => {
  it("prefers the live store label over the path label (the rename fix)", () => {
    const { label } = resolveCrumb(liveData({ label: "Renamed" }), pathNote({ label: "Stale" }))
    expect(label).toBe("Renamed")
  })

  it("falls back to the path label when there is no live record", () => {
    const { label } = resolveCrumb(undefined, pathNote({ label: "From path" }))
    expect(label).toBe("From path")
  })

  it("falls back to the path label when the live record has no label", () => {
    const { label } = resolveCrumb(liveData({}), pathNote({ label: "From path" }))
    expect(label).toBe("From path")
  })

  it("trims whitespace", () => {
    const { label } = resolveCrumb(liveData({ label: "  Spaced  " }), undefined)
    expect(label).toBe("Spaced")
  })

  it("uses UNTITLED_LABEL when both sources are empty / missing", () => {
    expect(resolveCrumb(undefined, undefined).label).toBe(UNTITLED_LABEL)
    expect(resolveCrumb(liveData({ label: "   " }), pathNote({ label: "" })).label).toBe(
      UNTITLED_LABEL,
    )
  })
})


describe("resolveCrumb — icon", () => {
  it("prefers the live store icon over the path icon", () => {
    const { icon } = resolveCrumb(liveData({ icon: CROWN }), pathNote({ icon: FIRE }))
    expect(icon).toEqual(CROWN)
  })

  it("falls back to the path icon when the live record has none", () => {
    const { icon } = resolveCrumb(liveData({ label: "x" }), pathNote({ icon: FIRE }))
    expect(icon).toEqual(FIRE)
  })

  it("returns null when neither source has a custom icon (caller uses kind icon)", () => {
    expect(resolveCrumb(liveData({ label: "x" }), pathNote({ label: "y" })).icon).toBeNull()
    expect(resolveCrumb(undefined, undefined).icon).toBeNull()
  })

  it("resolves label and icon independently (live label, path icon)", () => {
    const { label, icon } = resolveCrumb(
      liveData({ label: "Live" }),
      pathNote({ label: "Old", icon: FIRE }),
    )
    expect(label).toBe("Live")
    expect(icon).toEqual(FIRE)
  })
})
