import { describe, expect, it } from "vitest"
import type { Edge, Node } from "@canvas-harness/core"
import { asEdgeId, asNodeId } from "@canvas-harness/core"
import { diffSnapshots, EMPTY_SNAPSHOT, type Snapshot } from "./diff-snapshots"


const mkNode = (id: string, overrides: Partial<Node> = {}): Node => ({
  id: asNodeId(id),
  type: "rectangle",
  x: 0,
  y: 0,
  w: 100,
  h: 60,
  angle: 0,
  z: 0,
  groups: [],
  content: "",
  style: {},
  data: {
    noteType: "note",
    version: 1,
    graphUid: "b1",
    properties: {},
  },
  ...overrides,
})


const mkEdge = (id: string, sourceId: string, targetId: string): Edge => ({
  id: asEdgeId(id),
  source: { nodeId: asNodeId(sourceId), localOffset: { x: 50, y: 30 } },
  target: { nodeId: asNodeId(targetId), localOffset: { x: 50, y: 30 } },
  pathStyle: "bezier",
  z: 0,
  groups: [],
  content: "",
  style: {},
  data: { version: 1, createdAt: "2026-05-22T00:00:00.000Z", graphUid: "b1" },
})


const snap = (nodes: Node[], edges: Edge[] = []): Snapshot => ({ nodes, edges })


describe("diffSnapshots", () => {
  it("returns no calls when snapshots are identical", () => {
    const n = mkNode("n1")
    const e = mkEdge("e1", "n1", "n1")
    const prev = snap([n], [e])
    const next = snap([n], [e])
    expect(diffSnapshots(prev, next)).toEqual([])
  })

  it("emits addNote for new nodes", () => {
    const prev = EMPTY_SNAPSHOT
    const next = snap([mkNode("n1"), mkNode("n2")])
    const calls = diffSnapshots(prev, next)
    expect(calls.filter((c) => c.kind === "addNote")).toHaveLength(2)
    expect(calls.every((c) => c.kind === "addNote")).toBe(true)
  })

  it("emits removeNote for dropped nodes", () => {
    const prev = snap([mkNode("n1"), mkNode("n2")])
    const next = snap([mkNode("n1")])
    const calls = diffSnapshots(prev, next)
    expect(calls).toEqual([{ kind: "removeNote", noteId: "n2" }])
  })

  it("emits updateNote when a tracked node changes", () => {
    const prev = snap([mkNode("n1", { x: 0 })])
    const next = snap([mkNode("n1", { x: 200 })])
    const calls = diffSnapshots(prev, next)
    expect(calls).toHaveLength(1)
    expect(calls[0].kind).toBe("updateNote")
  })

  it("orders removes before adds and updates", () => {
    const prev = snap([mkNode("n1"), mkNode("n2")])
    const next = snap([mkNode("n1", { x: 50 }), mkNode("n3")])
    const calls = diffSnapshots(prev, next)
    const kinds = calls.map((c) => c.kind)
    const removeIdx = kinds.indexOf("removeNote")
    const addIdx = kinds.indexOf("addNote")
    const updateIdx = kinds.indexOf("updateNote")
    expect(removeIdx).toBeGreaterThanOrEqual(0)
    expect(addIdx).toBeGreaterThanOrEqual(0)
    expect(updateIdx).toBeGreaterThanOrEqual(0)
    expect(removeIdx).toBeLessThan(addIdx)
    expect(addIdx).toBeLessThan(updateIdx)
  })

  it("emits removeLink before removeNote (referential safety)", () => {
    const prev = snap([mkNode("n1"), mkNode("n2")], [mkEdge("e1", "n1", "n2")])
    const next = EMPTY_SNAPSHOT
    const calls = diffSnapshots(prev, next)
    const kinds = calls.map((c) => c.kind)
    expect(kinds.indexOf("removeLink")).toBeLessThan(kinds.indexOf("removeNote"))
  })

  it("emits addNote before addLink", () => {
    const next = snap([mkNode("n1"), mkNode("n2")], [mkEdge("e1", "n1", "n2")])
    const calls = diffSnapshots(EMPTY_SNAPSHOT, next)
    const kinds = calls.map((c) => c.kind)
    expect(kinds.indexOf("addNote")).toBeLessThan(kinds.indexOf("addLink"))
  })
})
