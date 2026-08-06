import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OpBatch } from "@canvas-harness/core"
import { addNode, freshStore, resetIdb } from "@/test/canvas"
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


/** A relay batch retagged `remote` (an acked/remote op — never an unsent-local). */
const remoteBatch = (nodeId: string): OpBatch => {
  const s = freshStore("peer")
  let captured: OpBatch | undefined
  const unsub = s.subscribe("change", (b) => {
    captured = b
  })
  addNode(s, nodeId)
  unsub()
  return { ...captured!, origin: "remote" as const }
}


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

  it("skips (no fetch) when the replica has an UNSENT local edit", async () => {
    // An unacked local edit isn't on the server, so it wouldn't be in the fetch;
    // folding the oplog away would drop it → defer (no fetch, no seed).
    const p = new BoardPersistence("b", { engine: h.stores.engine! })
    const store = freshStore("c")
    p.attach(store)
    addNode(store, "edit-1")
    await p.flush()

    const wrote = await materializeBoardOffline("b")
    expect(wrote).toBe(false)
    expect(h.getWholeBoard).not.toHaveBeenCalled()
  })

  it("materializes a synced board whose oplog is all acked (folds it, no double-apply)", async () => {
    // The regression this PR fixes: a board that's been edited but is fully
    // synced can now go offline. The acked edit IS on the server, so it's in the
    // fetch (below); folding the oplog away must not double-apply it.
    h.getWholeBoard.mockResolvedValue({
      nodes: [
        { id: "root-sheet", style: { type: "sheet" }, properties: {}, label: { markdown: "Root" }, parentId: null },
        { id: "folder", style: { type: "folder" }, properties: {}, label: { markdown: "F" }, parentId: null },
        { id: "child-sheet", style: { type: "sheet" }, properties: {}, label: { markdown: "Nested" }, parentId: "folder" },
        { id: "acked-1", style: { type: "sheet" }, properties: {}, label: { markdown: "Acked" }, parentId: null },
      ],
      edges: [],
    } as unknown as Graph)
    const p = new BoardPersistence("b", { engine: h.stores.engine! })
    const store = freshStore("c")
    p.attach(store)
    addNode(store, "acked-1")
    await p.flush()
    await p.setServerSeq(1, 100) // relay ack → on the server → present in the fetch
    p.close()

    const wrote = await materializeBoardOffline("b")
    expect(wrote).toBe(true)
    expect(h.getWholeBoard).toHaveBeenCalledWith("b")

    // Base = the fetch; the acked oplog is folded away (not replayed), so the
    // overlapping node "acked-1" appears exactly once.
    const content = await new BoardPersistence("b", { engine: h.stores.engine! }).load()
    expect(content.nodes.filter((n) => n.id === "acked-1")).toHaveLength(1)
    expect(content.nodes.map((n) => n.id).sort()).toEqual([
      "acked-1",
      "child-sheet",
      "folder",
      "root-sheet",
    ])
  })

  it("defers when a relay op is sequenced DURING the fetch (avoids double-apply)", async () => {
    // A remote op (NOT unsent-local) lands mid-fetch, so the defer is driven purely
    // by the oplog growing across the fetch window.
    h.getWholeBoard.mockImplementation(async () => {
      const p = new BoardPersistence("b", { engine: h.stores.engine! })
      p.recordRemote(remoteBatch("mid-peer"), 50)
      await p.flush()
      p.close()
      return wholeGraph()
    })

    const wrote = await materializeBoardOffline("b")
    expect(wrote).toBe(false) // oplog grew during the fetch → defer, don't fold
    expect(await h.stores.engine!.get("snapshots", "b")).toBeUndefined()
  })

  it("flushes the mounted writer so a BUFFERED mid-fetch relay op still defers", async () => {
    // The coordinator passes its live persistence; a peer op arriving in the last
    // ~debounce window of the fetch sits UNFLUSHED in `pending`. materialize must
    // flush it into IDB before the growth check, else it escapes the defer and
    // later replays on top of the base (double-apply). Here the mid-fetch op is
    // recorded but deliberately NOT flushed by the test.
    const persistence = new BoardPersistence("b", { engine: h.stores.engine! })
    h.getWholeBoard.mockImplementation(async () => {
      persistence.recordRemote(remoteBatch("buffered-peer"), 50) // stays in `pending`
      return wholeGraph()
    })

    const wrote = await materializeBoardOffline("b", { persistence, engine: h.stores.engine! })
    expect(wrote).toBe(false) // post-fetch flush surfaces the buffered op → defer
    expect(await h.stores.engine!.get("snapshots", "b")).toBeUndefined()
    persistence.close()
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
