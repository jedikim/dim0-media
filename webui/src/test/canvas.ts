/**
 * Deterministic test helpers for the canvas store + local persistence.
 *
 * Determinism: a fixed `clientId` makes generated ids reproducible. `resetIdb`
 * swaps in a fresh in-memory IndexedDB so each test (and each fuzz run) starts
 * clean.
 */
import { asClientId, asEdgeId, asNodeId, createCanvasStore } from "@canvas-harness/core"
import type { CanvasStore, Scene } from "@canvas-harness/core"
import { IDBFactory } from "fake-indexeddb"
import type { BoardContent, DimEdgeData, DimNodeData } from "@/features/board/model"
import { resetLocalStores } from "@/features/local-stores"


/**
 * Replace the global IndexedDB with a fresh, empty in-memory instance and drop
 * the shared local-stores singleton so it re-opens against the new database.
 */
export const resetIdb = (): void => {
  resetLocalStores()
  globalThis.indexedDB = new IDBFactory()
}


/** Create a canvas store with a stable clientId, optionally hydrated. */
export const freshStore = (clientId = "test-client", initial?: Scene): CanvasStore =>
  createCanvasStore(
    initial ? { clientId: asClientId(clientId), initial } : { clientId: asClientId(clientId) },
  )


const META: DimNodeData["meta"] = { v: 1, createdAt: 0, updatedAt: 0 }


/** Add a minimal rect node with an explicit id (so two stores can share ids). */
export const addNode = (store: CanvasStore, id: string, label = ""): void => {
  store.addNode({
    id: asNodeId(id),
    type: "rect",
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    angle: 0,
    groups: [],
    data: { label, meta: META } satisfies DimNodeData,
  })
}


/** Add an attached edge between two existing nodes, with an explicit id. */
export const addEdge = (store: CanvasStore, id: string, sourceId: string, targetId: string): void => {
  store.addEdge({
    id: asEdgeId(id),
    source: { nodeId: asNodeId(sourceId), localOffset: { x: 0, y: 0 } },
    target: { nodeId: asNodeId(targetId), localOffset: { x: 0, y: 0 } },
    pathStyle: "bezier",
    groups: [],
    data: { meta: META } satisfies DimEdgeData,
  })
}


const byId = <T extends { id: string }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))


/** Order-independent view of content for equality assertions. */
export const comparable = (c: BoardContent) => ({
  nodes: byId(c.nodes),
  edges: byId(c.edges),
  groups: byId(c.groups),
  frameOrder: c.frameOrder ?? [],
})
