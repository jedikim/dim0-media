import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { addNode, freshStore, resetIdb } from "@/test/canvas"
import { engineCases } from "@/test/engines"
import type { StorageEngine } from "./engine"
import { BoardPersistence } from "./board-persistence"
import { BoardRegistry, newLocalBoard } from "./board-registry"
import { IndexedDbEngine } from "./indexeddb-engine"


// Engine-agnostic behaviour — run against every StorageEngine.
for (const { label, make } of engineCases) describe(`BoardRegistry (${label})`, () => {
  let engine: StorageEngine


  beforeEach(async () => {
    engine = await make()
  })


  afterEach(() => {
    engine.close()
  })


  it("creates, gets, and lists local-only boards (no account)", async () => {
    const reg = new BoardRegistry({ engine })
    const a = newLocalBoard("Ideas", 1000)
    const b = newLocalBoard("Tasks", 2000)
    await reg.createBoard(a)
    await reg.createBoard(b)

    expect((await reg.getBoard(a.id))?.title).toBe("Ideas")
    expect((await reg.listBoards()).map((m) => m.title).sort()).toEqual(["Ideas", "Tasks"])
    expect((await reg.getBoard(a.id))?.kind).toBe("local-only")
  })


  it("setBoardContext stores the purpose + drift baseline, leaving title/kind intact", async () => {
    const reg = new BoardRegistry({ engine })
    const board = newLocalBoard("Ideas", 1000)
    await reg.createBoard(board)
    await reg.setBoardContext(board.id, "A board about trip planning.", { derivedAt: 5000, deriveSeq: 42 })
    const meta = await reg.getBoard(board.id)
    expect(meta?.context).toBe("A board about trip planning.")
    expect(meta?.contextDerivedAt).toBe(5000)
    expect(meta?.contextDeriveSeq).toBe(42)
    expect(meta?.title).toBe("Ideas") // untouched
    expect(meta?.kind).toBe("local-only")
  })


  it("setBoardContext no-ops for a board that doesn't exist", async () => {
    const reg = new BoardRegistry({ engine })
    await reg.setBoardContext("ghost", "x", { derivedAt: 1, deriveSeq: 1 })
    expect(await reg.getBoard("ghost")).toBeUndefined()
  })


  it("deleteBoard cascades: meta + view + content all removed, no orphans", async () => {
    const reg = new BoardRegistry({ engine })
    const board = newLocalBoard("Doomed", 1000)
    await reg.createBoard(board)
    await reg.saveView(board.id, { camera: { x: 1, y: 2, z: 1 }, selection: [] })

    // write some content
    const p = new BoardPersistence(board.id, { engine })
    const store = freshStore("c")
    p.attach(store)
    addNode(store, "n1")
    await p.flush()

    await reg.deleteBoard(board.id)

    expect(await reg.getBoard(board.id)).toBeUndefined()
    expect(await reg.loadView(board.id)).toBeUndefined()
    // content gone: a fresh persistence on the same engine loads empty
    const p2 = new BoardPersistence(board.id, { engine })
    expect((await p2.load()).nodes).toHaveLength(0)
  })


  it("deleteBoard cascades to the board's chats and messages, sparing other boards", async () => {
    const reg = new BoardRegistry({ engine })
    const board = newLocalBoard("Doomed", 1000)
    await reg.createBoard(board)

    await engine.put("chats", { id: "chat-1", boardId: board.id, updatedAt: 1 })
    await engine.put("chats", { id: "chat-2", boardId: board.id, updatedAt: 2 })
    await engine.put("chats", { id: "chat-x", boardId: "other-board", updatedAt: 3 })
    await engine.put("chat_messages", { chatUid: "chat-1", id: "m1", role: "user", content: { markdown: "hi" }, order: 0 })
    await engine.put("chat_messages", { chatUid: "chat-2", id: "m2", role: "user", content: { markdown: "yo" }, order: 0 })
    await engine.put("chat_messages", { chatUid: "chat-x", id: "mx", role: "user", content: { markdown: "keep" }, order: 0 })

    await reg.deleteBoard(board.id)

    expect(await engine.list("chats", { index: "by-board", range: { lower: board.id, upper: board.id } })).toHaveLength(0)
    expect(await engine.get("chat_messages", ["chat-1", "m1"])).toBeUndefined()
    expect(await engine.get("chat_messages", ["chat-2", "m2"])).toBeUndefined()
    expect(await engine.get("chats", "chat-x")).toBeDefined()
    expect(await engine.get("chat_messages", ["chat-x", "mx"])).toBeDefined()
  })


  it("deleteBoard cascades the sync cursor (sync_meta), sparing other boards", async () => {
    // A stale sync_meta left behind is a silent data-loss trap: re-hydrating the
    // same board id later would treat fresh edits as already-acked.
    const reg = new BoardRegistry({ engine })
    const board = newLocalBoard("Doomed", 1000)
    await reg.createBoard(board)
    await engine.put("sync_meta", { boardId: board.id, syncedSeq: 42 })
    await engine.put("sync_meta", { boardId: "other-board", syncedSeq: 7 })
    // Same trap for the agent snapshot cursor.
    await engine.put("snapshot_meta", { boardId: board.id, seenSeq: 42 })
    await engine.put("snapshot_meta", { boardId: "other-board", seenSeq: 7 })

    await reg.deleteBoard(board.id)

    expect(await engine.get("sync_meta", board.id)).toBeUndefined()
    expect(await engine.get("sync_meta", "other-board")).toBeDefined() // spared
    expect(await engine.get("snapshot_meta", board.id)).toBeUndefined()
    expect(await engine.get("snapshot_meta", "other-board")).toBeDefined() // spared
  })


  it("setSyncEngine flips the stored engine and bumps updatedAt; no-op if absent", async () => {
    const reg = new BoardRegistry({ engine })
    const board = newLocalBoard("Promotable", 1000)
    await reg.createBoard(board)
    expect((await reg.getBoard(board.id))?.syncEngine).toBeUndefined()

    await reg.setSyncEngine(board.id, "v2", 5000)
    const promoted = await reg.getBoard(board.id)
    expect(promoted?.syncEngine).toBe("v2")
    expect(promoted?.updatedAt).toBe(5000)
    // other fields preserved
    expect(promoted?.title).toBe("Promotable")
    expect(promoted?.kind).toBe("local-only")

    // no-op on a missing board (no throw, nothing created)
    await reg.setSyncEngine("ghost", "v2")
    expect(await reg.getBoard("ghost")).toBeUndefined()
  })


  it("markSynced promotes local → synced: sets kind, engine, owner; no-op if absent", async () => {
    const reg = new BoardRegistry({ engine })
    const board = newLocalBoard("Promote me", 1000)
    await reg.createBoard(board)
    expect((await reg.getBoard(board.id))?.kind).toBe("local-only")

    await reg.markSynced(board.id, { syncEngine: "v2", ownerId: "owner-1" }, 6000)
    const synced = await reg.getBoard(board.id)
    expect(synced?.kind).toBe("synced")
    expect(synced?.syncEngine).toBe("v2")
    expect(synced?.ownerId).toBe("owner-1")
    expect(synced?.updatedAt).toBe(6000)
    expect(synced?.title).toBe("Promote me") // content/title preserved

    await reg.markSynced("ghost", { syncEngine: "v2", ownerId: "x" })
    expect(await reg.getBoard("ghost")).toBeUndefined()
  })


  it("view state round-trips and is separate from content", async () => {
    const reg = new BoardRegistry({ engine })
    const board = newLocalBoard("Viewed", 1000)
    await reg.createBoard(board)

    const view = { camera: { x: 10, y: 20, z: 1.5 }, selection: [] }
    await reg.saveView(board.id, view)
    expect(await reg.loadView(board.id)).toEqual(view)

    // content carries no camera/selection (separation by construction)
    const p = new BoardPersistence(board.id, { engine })
    const content = await p.load()
    expect("camera" in content).toBe(false)
    expect("selection" in content).toBe(false)
  })


  it("setThumbnail stores a data URL on the board", async () => {
    const reg = new BoardRegistry({ engine })
    const board = newLocalBoard("Pic", 1000)
    await reg.createBoard(board)
    await reg.setThumbnail(board.id, "data:image/png;base64,AAAA")
    expect((await reg.getBoard(board.id))?.thumbnail).toBe("data:image/png;base64,AAAA")
  })


  it("setThumbnail is a no-op for a missing board", async () => {
    const reg = new BoardRegistry({ engine })
    await reg.setThumbnail("ghost", "data:image/png;base64,AAAA")
    expect(await reg.getBoard("ghost")).toBeUndefined()
  })
})


// Durability across connections is an IndexedDB property, not a port contract
// (InMemoryEngine deliberately doesn't persist), so these stay IndexedDB-specific.
describe("BoardRegistry (IndexedDB durability + lifecycle)", () => {
  beforeEach(() => {
    resetIdb()
  })


  it("survives a reload (a new connection sees prior boards)", async () => {
    const reg = new BoardRegistry()
    await reg.init()
    const board = newLocalBoard("Persisted", 1000)
    await reg.createBoard(board)
    reg.close()

    const reg2 = new BoardRegistry()
    await reg2.init()
    expect((await reg2.getBoard(board.id))?.title).toBe("Persisted")
    reg2.close()
  })


  it("close() leaves an injected engine open for its owner", async () => {
    const engine = await IndexedDbEngine.open()
    const reg = new BoardRegistry({ engine })
    reg.close()
    // The shared engine is still usable after the repo closes.
    await engine.put("boards", newLocalBoard("Still here", 1000))
    expect(await engine.list("boards")).toHaveLength(1)
    engine.close()
  })
})
