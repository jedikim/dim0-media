import { describe, expect, it } from "vitest"
import { DURABLE_DELETE, isDurableDelete } from "./durable-delete"


describe("isDurableDelete", () => {
  it("is true for the listed durable types", () => {
    expect(isDurableDelete("folder")).toBe(true)
    expect(isDurableDelete("document")).toBe(true)
  })

  it("is false for ordinary undoable node types", () => {
    expect(isDurableDelete("rect")).toBe(false)
    expect(isDurableDelete("mini-app")).toBe(false)
  })

  it("is false for missing / empty types", () => {
    expect(isDurableDelete(undefined)).toBe(false)
    expect(isDurableDelete(null)).toBe(false)
    expect(isDurableDelete("")).toBe(false)
  })

  it("does not treat inherited Object props as durable types", () => {
    expect(isDurableDelete("toString")).toBe(false)
    expect(isDurableDelete("constructor")).toBe(false)
  })

  it("every entry carries confirm-dialog copy", () => {
    for (const meta of Object.values(DURABLE_DELETE)) {
      expect(meta.title).toBeTruthy()
      expect(meta.description).toBeTruthy()
    }
  })
})
