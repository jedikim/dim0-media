import { describe, expect, it, vi } from "vitest"
import type { Op } from "@canvas-harness/core"
import type { BoardContent, DimEdge, DimNode } from "@/features/board/model"
import { contentToAddOps, enableSync } from "./enable-sync"


const node = (id: string): DimNode => ({ id, x: 0, y: 0, w: 10, h: 10 } as unknown as DimNode)
const edge = (id: string): DimEdge =>
  ({ id, source: { nodeId: "a" }, target: { nodeId: "b" } } as unknown as DimEdge)

const content = (nodes: DimNode[], edges: DimEdge[]): BoardContent => ({
  schemaVersion: 1 as unknown as BoardContent["schemaVersion"],
  nodes,
  edges,
  groups: [],
})


describe("contentToAddOps", () => {
  it("maps nodes to node.add and edges to edge.add, nodes first", () => {
    const ops = contentToAddOps(content([node("n1"), node("n2")], [edge("e1")]))
    expect(ops.map((o) => o.type)).toEqual(["node.add", "node.add", "edge.add"])
    expect((ops[0] as Extract<Op, { type: "node.add" }>).node.id).toBe("n1")
    expect((ops[2] as Extract<Op, { type: "edge.add" }>).edge.id).toBe("e1")
  })

  it("handles an empty board", () => {
    expect(contentToAddOps(content([], []))).toEqual([])
  })
})


const deps = (over: Partial<Parameters<typeof enableSync>[1]> = {}) => {
  const calls: string[] = []
  const base = {
    signedIn: true,
    ownerId: "owner-1",
    capture: vi.fn(async () => {
      calls.push("capture")
      return { content: content([node("n1")], []), seq: 7 }
    }),
    adopt: vi.fn(async () => {
      calls.push("adopt")
    }),
    foldBase: vi.fn(async () => {
      calls.push("foldBase")
    }),
    markSynced: vi.fn(async () => {
      calls.push("markSynced")
    }),
  }
  return { deps: { ...base, ...over }, calls, base }
}


describe("enableSync", () => {
  it("signed out: returns signed-out and touches nothing", async () => {
    const { deps: d } = deps({ signedIn: false })
    const res = await enableSync("b1", d)
    expect(res).toEqual({ ok: false, reason: "signed-out" })
    expect(d.adopt).not.toHaveBeenCalled()
    expect(d.foldBase).not.toHaveBeenCalled()
    expect(d.markSynced).not.toHaveBeenCalled()
  })

  it("success: capture → adopt → foldBase → markSynced in order", async () => {
    const { deps: d, calls } = deps()
    const res = await enableSync("b1", d)
    expect(res).toEqual({ ok: true, boardId: "b1" })
    expect(calls).toEqual(["capture", "adopt", "foldBase", "markSynced"])
    expect(d.adopt).toHaveBeenCalledWith([{ type: "node.add", node: expect.objectContaining({ id: "n1" }) }])
    expect(d.markSynced).toHaveBeenCalledWith("owner-1")
  })

  it("foldBase gets the captured base + seq (so the tail truncation is bounded)", async () => {
    const { deps: d } = deps()
    await enableSync("b1", d)
    expect(d.foldBase).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: expect.any(Array) }),
      7, // the captured seq — foldBase must truncate ONLY up to here
    )
  })

  it("adopt fails: stays local (never folds or marks synced)", async () => {
    const { deps: d } = deps({
      adopt: vi.fn(async () => {
        throw new Error("network")
      }),
    })
    const res = await enableSync("b1", d)
    expect(res.ok).toBe(false)
    expect(res).toMatchObject({ reason: "error" })
    expect(d.foldBase).not.toHaveBeenCalled()
    expect(d.markSynced).not.toHaveBeenCalled()
  })

  it("foldBase fails after adopt: stays local (never marks synced), so a retry is safe", async () => {
    const { deps: d } = deps({
      foldBase: vi.fn(async () => {
        throw new Error("idb")
      }),
    })
    const res = await enableSync("b1", d)
    expect(res).toMatchObject({ ok: false, reason: "error" })
    expect(d.markSynced).not.toHaveBeenCalled()
  })
})
