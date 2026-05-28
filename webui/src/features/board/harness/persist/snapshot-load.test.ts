import { describe, expect, it, vi } from "vitest"
import { asNodeId, type Node } from "@canvas-harness/core"
import { createBoardStore } from "../store/create-board-store"
import type { Graph } from "@/features/board/types/board"


// Mock the network layer so we can drive resolution timing from the test.
const getBoardMock = vi.fn<
  (boardId: string, rootId?: string) => Promise<{ graph: Graph; canEdit: boolean }>
>()


vi.mock("@/features/board/api/get-board", () => ({
  getBoard: (boardId: string, rootId?: string) => getBoardMock(boardId, rootId),
}))


// Import the SUT after the mock is registered so its closure uses the
// mocked `getBoard`.
import { hydrateBoardStore } from "./snapshot-load"


const seedNode = (id: string): Node => ({
  id: asNodeId(id),
  type: "rect",
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  angle: 0,
  z: 0,
  groups: [],
  content: "",
  style: {},
})


const emptyGraph = (): Graph =>
  ({
    label: "test",
    visibility: "private",
    nodes: [],
    edges: [],
  }) as unknown as Graph


describe("hydrateBoardStore — cancel safety", () => {
  it("happy path: mutates the store with the fetched graph", async () => {
    getBoardMock.mockResolvedValueOnce({ graph: emptyGraph(), canEdit: true })
    const store = createBoardStore()
    store.addNode(seedNode("pre-existing"))

    await hydrateBoardStore(store, { boardId: "b1" })

    // Pre-existing node was wiped, fetched graph (empty) was loaded.
    expect(store.getAllNodes()).toHaveLength(0)
  })

  it("skips the store mutation when isCancelled() flips true before the batch", async () => {
    let cancelled = false
    // Resolve the fetch only after we've flipped the cancel flag.
    const resolvers: { resolve?: () => void } = {}
    const fetchPromise = new Promise<{ graph: Graph; canEdit: boolean }>((res) => {
      resolvers.resolve = () => res({ graph: emptyGraph(), canEdit: true })
    })
    getBoardMock.mockImplementationOnce(() => fetchPromise)

    const store = createBoardStore()
    const preNode = seedNode("survives")
    store.addNode(preNode)

    const hydration = hydrateBoardStore(store, {
      boardId: "b2",
      isCancelled: () => cancelled,
    })

    // Simulate "user navigated away" before the fetch lands.
    cancelled = true
    resolvers.resolve?.()
    await hydration

    // Pre-existing node is still there: the stale hydrate skipped its
    // store mutation entirely.
    expect(store.getAllNodes()).toHaveLength(1)
    expect(store.getAllNodes()[0].id as unknown as string).toBe("survives")
  })

  it("respects cancellation between two interleaved hydrates", async () => {
    // Two hydrates in flight; first one will be cancelled, second wins.
    const aResolvers: { resolve?: () => void } = {}
    const bResolvers: { resolve?: () => void } = {}
    const fetchA = new Promise<{ graph: Graph; canEdit: boolean }>((res) => {
      aResolvers.resolve = () =>
        res({
          graph: { ...emptyGraph(), nodes: [{ id: "from-a" } as never] } as Graph,
          canEdit: true,
        })
    })
    const fetchB = new Promise<{ graph: Graph; canEdit: boolean }>((res) => {
      bResolvers.resolve = () => res({ graph: emptyGraph(), canEdit: true })
    })
    getBoardMock.mockImplementationOnce(() => fetchA).mockImplementationOnce(() => fetchB)

    const store = createBoardStore()

    let cancelledA = false
    const hydrationA = hydrateBoardStore(store, {
      boardId: "a",
      isCancelled: () => cancelledA,
    })
    const hydrationB = hydrateBoardStore(store, { boardId: "b" })

    // User navigated A → B before A resolved.
    cancelledA = true

    // B resolves first (empty), then A resolves (would have content
    // "from-a"). The cancel guard on A keeps it from clobbering.
    bResolvers.resolve?.()
    await hydrationB
    aResolvers.resolve?.()
    await hydrationA

    // Store reflects B (empty), not A's stale content.
    expect(store.getAllNodes()).toHaveLength(0)
  })
})
