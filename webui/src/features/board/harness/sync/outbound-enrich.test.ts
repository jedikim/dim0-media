import { describe, expect, it } from "vitest"
import { asBatchId, asClientId, asEdgeId, asNodeId } from "@canvas-harness/core"
import type { Edge, OpBatch } from "@canvas-harness/core"
import { addNode, freshStore } from "@/test/canvas"
import { enrichEdgeMidpoints } from "./outbound-enrich"


const batch = (ops: OpBatch["ops"]): OpBatch => ({
  id: asBatchId("b"),
  clientId: asClientId("c"),
  ts: 0,
  origin: "local",
  ops,
})


describe("enrichEdgeMidpoints", () => {
  it("attaches _midpoint to an edge.add with control points, leaving the raw batch untouched", () => {
    const store = freshStore("c")
    addNode(store, "n1") // (0,0) 100x50
    addNode(store, "n2")
    const b = batch([{
      type: "edge.add",
      edge: {
        id: asEdgeId("e1"),
        source: { nodeId: asNodeId("n1"), localOffset: { x: 0, y: 0 } },
        target: { nodeId: asNodeId("n2"), localOffset: { x: 0, y: 0 } },
        pathStyle: "bezier",
        groups: [],
        data: {},
        control: [{ x: 40, y: 80 }, { x: 40, y: 80 }],
      } as unknown as Edge,
    }])

    const out = enrichEdgeMidpoints(b, store)

    const outMid = (out.ops[0] as { edge: { _midpoint?: { x: number; y: number } } }).edge._midpoint
    expect(outMid).toBeDefined()
    // (S + T + 6c)/8 with S=T=(0,0), c=(40,80) → (30, 60)
    expect(outMid).toEqual({ x: 30, y: 60 })
    // raw batch untouched (clone returned)
    expect(out).not.toBe(b)
    expect((b.ops[0] as { edge: { _midpoint?: unknown } }).edge._midpoint).toBeUndefined()
  })


  it("returns the original batch when there's nothing to enrich", () => {
    const store = freshStore("c")
    addNode(store, "n1")
    const b = batch([{
      type: "node.update",
      id: asNodeId("n1"),
      patch: { x: 5 },
      prev: { x: 0 },
    }])

    const out = enrichEdgeMidpoints(b, store)
    expect(out).toBe(b) // same reference, no clone
  })


  it("skips an edge with no control points (default curve needs no midpoint)", () => {
    const store = freshStore("c")
    addNode(store, "n1")
    addNode(store, "n2")
    const b = batch([{
      type: "edge.add",
      edge: {
        id: asEdgeId("e1"),
        source: { nodeId: asNodeId("n1"), localOffset: { x: 0, y: 0 } },
        target: { nodeId: asNodeId("n2"), localOffset: { x: 0, y: 0 } },
        pathStyle: "bezier",
        groups: [],
        data: {},
      } as unknown as Edge,
    }])

    const out = enrichEdgeMidpoints(b, store)
    expect(out).toBe(b) // no control → no enrichment
  })
})
