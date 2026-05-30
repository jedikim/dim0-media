import { describe, expect, it, vi } from "vitest"
import { asClientId, asNodeId, type Node } from "@canvas-harness/core"
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
import { applyGraphToStore, hydrateBoardStore } from "./snapshot-load"


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

  it("applyGraphToStore is callable standalone — used by the WS welcome path", () => {
    // The Phase 1c.1 WS welcome handler replays the snapshot directly
    // into the store via `applyGraphToStore`, no REST fetch involved.
    // This test pins that contract: pre-existing local state is wiped,
    // the snapshot's nodes/edges are loaded fresh.
    const store = createBoardStore()
    store.addNode(seedNode("stale-from-rest"))
    expect(store.getAllNodes()).toHaveLength(1)

    applyGraphToStore(store, emptyGraph())

    expect(store.getAllNodes()).toHaveLength(0)
    expect(store.getAllEdges()).toHaveLength(0)
  })

  it("applyGraphToStore mode=merge is a no-op on empty graph (preserves store)", () => {
    // Regression: server returns `{}` from `read_snapshot_payload`
    // whenever `get_graph` returns None (DB hiccup, board not yet
    // committed). Replace mode would wipe the canvas; merge must skip.
    const store = createBoardStore()
    store.addNode(seedNode("survives"))
    expect(store.getAllNodes()).toHaveLength(1)

    applyGraphToStore(store, emptyGraph(), { mode: "merge" })

    // Pre-existing node was preserved, not wiped.
    expect(store.getAllNodes()).toHaveLength(1)
    expect(store.getAllNodes()[0].id as unknown as string).toBe("survives")
  })

  it("applyGraphToStore mode=replace wipes the store on empty graph", () => {
    // Replace mode is the first-load REST path — it must clear stale
    // state from a previous scope. This is the opposite contract from
    // merge mode and the reason the two modes exist.
    const store = createBoardStore()
    store.addNode(seedNode("gone"))
    expect(store.getAllNodes()).toHaveLength(1)

    applyGraphToStore(store, emptyGraph(), { mode: "replace" })

    expect(store.getAllNodes()).toHaveLength(0)
  })

  it("applyGraphToStore mode=replace clears remote presences from the previous board", () => {
    // Regression: navigating board A → B used to leave board A's
    // peer entries in `store.presence` because the WS adapter's
    // cleanup only resets local presence. The peer chip + remote
    // cursors then showed stale avatars on board B until those peers
    // happened to send something. Replace mode now clears remote
    // presences so the new welcome's `presence` map repopulates from
    // a clean slate.
    const store = createBoardStore()
    store.presence.applyRemote(asClientId("alice"), {
      clientId: asClientId("alice"),
      name: "Alice",
      color: "#abc",
      cursor: null,
      selection: [],
      editing: null,
    })
    store.presence.applyRemote(asClientId("bob"), {
      clientId: asClientId("bob"),
      name: "Bob",
      color: "#def",
      cursor: null,
      selection: [],
      editing: null,
    })
    expect(store.presence.getAll().size).toBe(2)

    applyGraphToStore(store, emptyGraph(), { mode: "replace" })

    expect(store.presence.getAll().size).toBe(0)
  })

  it("applyGraphToStore mode=merge leaves remote presences alone (no clobber on reconnect)", () => {
    // Merge mode runs on WS welcome (snapshot mode), which can fire
    // during a reconnect mid-session. We must NOT wipe existing
    // remote presences there — those are valid peers in the same
    // room, and the welcome's `presence` map is added on top via
    // `applyRemote` in use-ws-collab. Only replace mode (board nav)
    // clears them.
    const store = createBoardStore()
    store.presence.applyRemote(asClientId("alice"), {
      clientId: asClientId("alice"),
      name: "Alice",
      color: "#abc",
      cursor: null,
      selection: [],
      editing: null,
    })

    applyGraphToStore(store, emptyGraph(), { mode: "merge" })

    expect(store.presence.getAll().size).toBe(1)
  })

  it("applyGraphToStore mode=merge updates existing nodes in place and removes absent ones", () => {
    // Merge mode is used by the WS welcome handler. It should reconcile
    // the store toward the snapshot WITHOUT a wholesale wipe — selection
    // and focus stay attached to the same node ids, and the React
    // listener doesn't see a remove+add cycle for every untouched node.
    const store = createBoardStore()
    // Pre-existing state: keep "n1", remove "n2", add "n3", update n1's position.
    store.addNode({ ...seedNode("n1"), x: 0, y: 0 })
    store.addNode({ ...seedNode("n2"), x: 100, y: 100 })

    const graph: Graph = {
      ...emptyGraph(),
      nodes: [
        {
          id: "n1",
          type: "note",
          version: 1,
          graphUid: "b1",
          properties: {
            nodePosition: { type: "position", position: { x: 50, y: 50 } },
            nodeSize: { type: "size", size: { width: 10, height: 10 } },
            nodeZIndex: { type: "number", number: 0 },
          },
          style: { type: "rectangle" },
          createdAt: "2026-01-01T00:00:00",
        } as never,
        {
          id: "n3",
          type: "note",
          version: 1,
          graphUid: "b1",
          properties: {
            nodePosition: { type: "position", position: { x: 300, y: 300 } },
            nodeSize: { type: "size", size: { width: 10, height: 10 } },
            nodeZIndex: { type: "number", number: 0 },
          },
          style: { type: "rectangle" },
          createdAt: "2026-01-01T00:00:00",
        } as never,
      ],
    } as Graph

    applyGraphToStore(store, graph, { mode: "merge" })

    const byId = new Map(
      store.getAllNodes().map((n) => [n.id as unknown as string, n]),
    )
    // n2 was absent → removed.
    expect(byId.has("n2")).toBe(false)
    // n1 was present → updated in place.
    expect(byId.get("n1")?.x).toBe(50)
    expect(byId.get("n1")?.y).toBe(50)
    // n3 was new → added.
    expect(byId.get("n3")?.x).toBe(300)
  })

  it("applyGraphToStore expects camelCase keys — node positions land correctly", () => {
    // Regression: WS welcome ships Pydantic's `model_dump()` which is
    // snake_case; the use-ws-collab handler runs `camelcaseKeys` first
    // before calling this. Without the conversion every note's
    // `node_position` is invisible to `noteToNode`, defaulting to
    // (0,0) → all nodes stack at the origin. This test exercises the
    // post-conversion contract: camelCase in, positions preserved.
    const store = createBoardStore()
    const graph: Graph = {
      ...emptyGraph(),
      nodes: [
        {
          id: "n1",
          type: "note",
          version: 1,
          graphUid: "b1",
          properties: {
            nodePosition: { type: "position", position: { x: 150, y: 220 } },
            nodeSize: { type: "size", size: { width: 200, height: 100 } },
            nodeZIndex: { type: "number", number: 0 },
          },
          style: { type: "rectangle" },
          createdAt: "2026-01-01T00:00:00",
        } as never,
      ],
    } as Graph

    applyGraphToStore(store, graph)

    const [node] = store.getAllNodes()
    expect(node).toBeDefined()
    expect(node.x).toBe(150)
    expect(node.y).toBe(220)
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
