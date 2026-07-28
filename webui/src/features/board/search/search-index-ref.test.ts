import { afterEach, describe, expect, it } from "vitest"
import { LocalSearchIndex } from "./local-index"
import { getSearchIndexRef, setSearchIndexRef } from "./search-index-ref"


afterEach(() => {
  setSearchIndexRef(null)
})


describe("search-index-ref", () => {
  it("is null when nothing is registered", () => {
    expect(getSearchIndexRef()).toBeNull()
  })


  it("returns the registered index", () => {
    const index = new LocalSearchIndex()
    setSearchIndexRef(index)
    expect(getSearchIndexRef()).toBe(index)
  })


  it("clears back to null", () => {
    setSearchIndexRef(new LocalSearchIndex())
    setSearchIndexRef(null)
    expect(getSearchIndexRef()).toBeNull()
  })
})
