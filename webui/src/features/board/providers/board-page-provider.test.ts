import { describe, expect, it } from "vitest"
import type { IconProperty } from "@/features/newsfeed/types/properties"
import { createDefaultNote, type Note } from "../types/note"
import { noteToPage } from "./board-page-provider"


type IconValue = NonNullable<IconProperty["icon"]>

const STAR: IconValue = { type: "phosphor", name: "Star", color: null }


function note(opts: { label?: string; icon?: IconValue; markdown?: string }): Note {
  const n = createDefaultNote({ boardId: "b", nodeType: "sheet" })
  if (opts.label !== undefined) n.label = { markdown: opts.label }
  if (opts.icon !== undefined) n.properties.iconData = { type: "icon", icon: opts.icon }
  if (opts.markdown !== undefined) n.content = { markdown: opts.markdown }
  return n
}


describe("noteToPage", () => {
  it("carries the note's custom icon onto the page (the chip-icon fix)", () => {
    expect(noteToPage(note({ label: "Doc", icon: STAR })).icon).toEqual(STAR)
  })

  it("returns a null icon when the note has none (chip falls back to default)", () => {
    expect(noteToPage(note({ label: "Doc" })).icon).toBeNull()
  })

  it("uses the note's label as the title", () => {
    expect(noteToPage(note({ label: "My page" })).title).toBe("My page")
  })

  it("falls back to 'Untitled' for a blank label", () => {
    expect(noteToPage(note({ label: "   " })).title).toBe("Untitled")
    expect(noteToPage(note({})).title).toBe("Untitled")
  })

  it("derives a one-line snippet from the body markdown", () => {
    const page = noteToPage(note({ label: "x", markdown: "# Heading\n\n- bullet one\n- bullet two" }))
    expect(page.snippet).toBe("Heading bullet one bullet two")
  })

  it("passes through id and parentId", () => {
    const n = note({ label: "child" })
    n.parentId = "parent-1"
    const page = noteToPage(n)
    expect(page.id).toBe(n.id)
    expect(page.parentId).toBe("parent-1")
  })
})
