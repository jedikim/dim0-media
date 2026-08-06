import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetIdb } from "@/test/canvas"
import type { Graph } from "@/features/board/types/board"
import { IndexedDbEngine } from "./indexeddb-engine"
import { BoardPersistence } from "./board-persistence"


// Mock the network fetch + the stores composition root (a fresh IndexedDbEngine
// per test). `vi.hoisted` so the mock factories can reference them.
const h = vi.hoisted(() => ({
  getWholeBoard: vi.fn(),
  stores: { engine: null as IndexedDbEngine | null },
}))

vi.mock("@/features/local-stores", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getLocalStores: async () => h.stores,
}))
vi.mock("@/features/board/api/get-board", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getWholeBoard: h.getWholeBoard,
}))

// Imported after the mocks are registered.
const { materializeBoardOffline } = await import("./materialize-board")


/** A minimal whole-board graph: a root sheet + a sheet nested in a folder. */
const wholeGraph = (): Graph =>
  ({
    nodes: [
      { id: "root-sheet", style: { type: "sheet" }, properties: {}, label: { markdown: "Root" }, parentId: null },
      { id: "folder", style: { type: "folder" }, properties: {}, label: { markdown: "F" }, parentId: null },
      { id: "child-sheet", style: { type: "sheet" }, properties: {}, label: { markdown: "Nested" }, parentId: "folder" },
    ],
    edges: [],
  }) as unknown as Graph


beforeEach(async () => {
  resetIdb()
  h.stores.engine = await IndexedDbEngine.open()
  h.getWholeBoard.mockReset()
})


describe("materializeBoardOffline", () => {
  it("fetches the whole board and persists all layers as the offline base", async () => {
    h.getWholeBoard.mockResolvedValue(wholeGraph())

    const wrote = await materializeBoardOffline("b")
    expect(wrote).toBe(true)
    expect(h.getWholeBoard).toHaveBeenCalledWith("b")

    // A fresh instance (next session / offline) loads the whole board — every
    // layer, not just the root one.
    const content = await new BoardPersistence("b", { engine: h.stores.engine! }).load()
    expect(content.nodes.map((n) => n.id).sort()).toEqual([
      "child-sheet",
      "folder",
      "root-sheet",
    ])
  })

  it("skips the fetch when a local base already exists (idempotent)", async () => {
    h.getWholeBoard.mockResolvedValue(wholeGraph())
    await materializeBoardOffline("b") // seeds
    h.getWholeBoard.mockClear()

    const wrote = await materializeBoardOffline("b") // already offline
    expect(wrote).toBe(false)
    expect(h.getWholeBoard).not.toHaveBeenCalled()
  })

  it("skips (no fetch) when the replica already has local edits", async () => {
    // Not pristine: an oplog exists but no base — must not fetch or seed.
    const p = new BoardPersistence("b", { engine: h.stores.engine! })
    const { addNode, freshStore } = await import("@/test/canvas")
    const store = freshStore("c")
    p.attach(store)
    addNode(store, "edit-1")
    await p.flush()

    const wrote = await materializeBoardOffline("b")
    expect(wrote).toBe(false)
    expect(h.getWholeBoard).not.toHaveBeenCalled()
  })

  it("seeds a base for a genuinely empty whole-board graph (offline-available)", async () => {
    // An empty board is trivially offline-available (nothing to load), so it
    // writes an (empty) base and reports success — the offline marker can flip.
    h.getWholeBoard.mockResolvedValue({ nodes: [], edges: [] } as unknown as Graph)
    const wrote = await materializeBoardOffline("b")
    expect(wrote).toBe(true)
    expect(h.getWholeBoard).toHaveBeenCalledWith("b")

    const content = await new BoardPersistence("b", { engine: h.stores.engine! }).load()
    expect(content.nodes).toEqual([])
  })

  it("de-dupes concurrent calls into a single whole-board fetch", async () => {
    h.getWholeBoard.mockResolvedValue(wholeGraph())
    const [a, b] = await Promise.all([
      materializeBoardOffline("b"),
      materializeBoardOffline("b"),
    ])
    // One shared in-flight run: fetched once, and only one caller wrote.
    expect(h.getWholeBoard).toHaveBeenCalledTimes(1)
    expect([a, b].filter(Boolean)).toHaveLength(2) // both observe the same true
  })
})
