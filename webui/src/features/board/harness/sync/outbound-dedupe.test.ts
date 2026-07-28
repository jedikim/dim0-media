import { describe, expect, it } from "vitest"
import { asBatchId, asClientId, asNodeId } from "@canvas-harness/core"
import type { Node, Op, OpBatch } from "@canvas-harness/core"
import { dedupeRepeatUpdates } from "./outbound-dedupe"


const batch = (ops: Op[]): OpBatch => ({
  id: asBatchId("b"),
  clientId: asClientId("c"),
  ts: 0,
  origin: "local",
  ops,
})


const node = (id: string): Node =>
  ({
    id: asNodeId(id), type: "rect", x: 0, y: 0, z: 0, w: 100, h: 50, angle: 0,
    groups: [], data: {},
  }) as unknown as Node


const upd = (id: string, patch: Record<string, unknown>, prev: Record<string, unknown>): Op =>
  ({ type: "node.update", id: asNodeId(id), patch, prev }) as unknown as Op


describe("dedupeRepeatUpdates", () => {
  it("merges repeat same-target updates, keeps the first prev, preserves order", () => {
    const b = batch([
      upd("n1", { x: 1 }, { x: 0 }),
      { type: "node.add", node: node("n3") } as Op,
      upd("n1", { y: 2 }, { y: 99 }), // later update to n1
      upd("n2", { x: 5 }, { x: 0 }),
    ])

    const out = dedupeRepeatUpdates(b)

    expect(out).not.toBe(b) // collapsed → new batch
    expect(out.ops).toHaveLength(3)
    const [o0, o1, o2] = out.ops as Array<{ type: string; id?: string; patch?: Record<string, unknown>; prev?: Record<string, unknown> }>
    expect(o0.type).toBe("node.update")
    expect(o0.id).toBe("n1")
    expect(o0.patch).toEqual({ x: 1, y: 2 }) // merged, last value per field
    expect(o0.prev).toEqual({ x: 0 }) // FIRST prev kept, not the later {y:99}
    expect(o1.type).toBe("node.add") // non-update passes through in order
    expect(o2.id).toBe("n2")
  })


  it("does not mutate the input batch", () => {
    const b = batch([upd("n1", { x: 1 }, { x: 0 }), upd("n1", { x: 2 }, { x: 1 })])
    const before = JSON.stringify(b)

    dedupeRepeatUpdates(b)

    expect(JSON.stringify(b)).toBe(before) // original untouched
    expect(b.ops).toHaveLength(2)
  })


  it("returns the same reference when nothing collapses", () => {
    const b = batch([upd("n1", { x: 1 }, { x: 0 }), upd("n2", { x: 1 }, { x: 0 })])
    expect(dedupeRepeatUpdates(b)).toBe(b)
  })


  it("keeps node.update and edge.update on the same id distinct", () => {
    const b = batch([
      upd("x", { a: 1 }, {}),
      { type: "edge.update", id: asNodeId("x"), patch: { b: 2 }, prev: {} } as unknown as Op,
    ])
    // Different op kinds → different keys → both kept.
    expect(dedupeRepeatUpdates(b).ops).toHaveLength(2)
  })
})
