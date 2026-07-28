import { afterEach, describe, expect, it } from "vitest"
import { addNode, freshStore } from "@/test/canvas"
import { LocalSearchIndex } from "./local-index"
import { getSearchIndexRef, setSearchIndexRef } from "./search-index-ref"
import { wireSearchIndex } from "./use-search-index"


afterEach(() => {
  setSearchIndexRef(null)
})


describe("wireSearchIndex", () => {
  it("publishes the index on the module ref (so the agent can reach it)", () => {
    const store = freshStore("c")
    const index = new LocalSearchIndex()
    const cleanup = wireSearchIndex(store, index)
    expect(getSearchIndexRef()).toBe(index)
    cleanup()
  })


  it("keeps the index in sync with store changes while attached", async () => {
    const store = freshStore("c")
    const index = new LocalSearchIndex()
    const cleanup = wireSearchIndex(store, index)

    addNode(store, "n1", "quarterly revenue")
    await index.idle()

    expect(index.has("n1")).toBe(true)
    expect(await index.query("revenue")).toContain("n1")
    cleanup()
  })


  it("cleanup clears the ref and detaches (later edits are not indexed)", async () => {
    const store = freshStore("c")
    const index = new LocalSearchIndex()
    const cleanup = wireSearchIndex(store, index)

    addNode(store, "n1", "before cleanup")
    await index.idle()
    expect(index.has("n1")).toBe(true)

    cleanup()
    expect(getSearchIndexRef()).toBeNull()

    // Detached: a change after cleanup must not reach the index.
    addNode(store, "n2", "after cleanup")
    await index.idle()
    expect(index.has("n2")).toBe(false)
  })
})
