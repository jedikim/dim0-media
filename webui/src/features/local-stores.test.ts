import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetIdb } from "@/test/canvas"
import { IndexedDbEngine } from "@/features/board/persist/local/indexeddb-engine"
import { newLocalBoard } from "@/features/board/persist/local/board-registry"
import { createLocalStores, getLocalStores, resetLocalStores } from "./local-stores"


beforeEach(() => {
  resetIdb()
})


describe("createLocalStores", () => {
  it("composes all repos over one shared engine", async () => {
    const engine = await IndexedDbEngine.open()
    const stores = createLocalStores(engine)
    expect(stores.engine).toBe(engine)

    // A board written via the registry is visible through the same engine.
    const board = newLocalBoard("Shared", 1000)
    await stores.boards.createBoard(board)
    expect(await engine.get("boards", board.id)).toBeDefined()

    // Chats + mini-app state share that engine too.
    await stores.chats.saveTranscript("c1", board.id, [], "Chat")
    expect(await stores.chats.getChat("c1")).toBeDefined()
    await stores.miniApps.putState("n1", { ok: true })
    expect(await stores.miniApps.getState("n1")).toEqual({ ok: true })

    engine.close()
  })
})


describe("getLocalStores (singleton)", () => {
  it("returns the same instance across calls", async () => {
    const a = await getLocalStores()
    const b = await getLocalStores()
    expect(a).toBe(b)
  })


  it("shares one engine across concurrent first-callers", async () => {
    const [a, b] = await Promise.all([getLocalStores(), getLocalStores()])
    expect(a).toBe(b)
  })


  it("resetLocalStores forces a fresh instance", async () => {
    const a = await getLocalStores()
    resetLocalStores()
    const b = await getLocalStores()
    expect(a).not.toBe(b)
  })


  it("all repos read/write through the singleton engine", async () => {
    const stores = await getLocalStores()
    await stores.boards.createBoard(newLocalBoard("Via singleton", 1000))
    expect(await stores.boards.listBoards()).toHaveLength(1)
  })


  it("does not cache a failed open — a later call retries and succeeds", async () => {
    resetLocalStores() // clear any singleton from earlier tests
    const spy = vi.spyOn(IndexedDbEngine, "open").mockRejectedValueOnce(new Error("open failed"))

    await expect(getLocalStores()).rejects.toThrow("open failed")
    // The rejected open must NOT be cached: the next call retries (spy falls
    // through to the real open) and resolves.
    const stores = await getLocalStores()
    expect(stores.engine).toBeDefined()

    spy.mockRestore()
    resetLocalStores()
  })
})
