import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetIdb } from "@/test/canvas"
import { IndexedDbEngine } from "@/features/board/persist/local/indexeddb-engine"
import { emptyContent } from "@/features/board/persist/local/codec"
import type { SnapshotRecord } from "@/features/board/persist/local/idb"


const h = vi.hoisted(() => ({ stores: { engine: null as IndexedDbEngine | null } }))
vi.mock("@/features/local-stores", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getLocalStores: async () => h.stores,
}))

const { isBoardAvailableOffline } = await import("./board-offline-status")


beforeEach(async () => {
  resetIdb()
  h.stores.engine = await IndexedDbEngine.open()
})


describe("isBoardAvailableOffline", () => {
  it("is false with no local snapshot, true once a base exists", async () => {
    expect(await isBoardAvailableOffline("b")).toBe(false)

    // Seeding a snapshot row (what materializeBoardOffline → foldBase does) marks it offline-ready.
    await h.stores.engine!.put<SnapshotRecord>(
      "snapshots",
      { content: emptyContent(), seq: 0 },
      "b",
    )

    expect(await isBoardAvailableOffline("b")).toBe(true)
    expect(await isBoardAvailableOffline("other")).toBe(false)
  })
})
