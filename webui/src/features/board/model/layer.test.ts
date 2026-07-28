import { describe, expect, it } from "vitest"
import { asNodeId } from "@canvas-harness/core"
import type { BoardContent, DimEdge, DimNode } from "."
import { buildLayerPath, filterContentByLayer } from "./layer"


const node = (id: string, parentId?: string | null, label?: string): DimNode =>
  ({ id: asNodeId(id), data: { parentId, label, meta: { v: 1, createdAt: 0, updatedAt: 0 } } }) as unknown as DimNode


const edge = (id: string, parentId?: string | null): DimEdge =>
  ({ id, data: { parentId, meta: { v: 1, createdAt: 0, updatedAt: 0 } } }) as unknown as DimEdge


const content = (nodes: DimNode[], edges: DimEdge[] = []): BoardContent =>
  ({ schemaVersion: 1, nodes, edges, groups: [{ id: "g1" }], frameOrder: [asNodeId("f1")] }) as unknown as BoardContent


describe("filterContentByLayer", () => {
  it("keeps only root-layer nodes/edges when rootId is null", () => {
    const c = content(
      [node("a"), node("b", null), node("child", "folder1")],
      [edge("e-root", null), edge("e-child", "folder1")],
    )
    const out = filterContentByLayer(c, null)
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "b"]) // undefined + null parentId = root
    expect(out.edges.map((e) => e.id)).toEqual(["e-root"])
  })


  it("keeps only the folder's layer when rootId is a folder id", () => {
    const c = content(
      [node("root"), node("c1", "folder1"), node("c2", "folder1"), node("other", "folder2")],
      [edge("e1", "folder1"), edge("e2", "folder2")],
    )
    const out = filterContentByLayer(c, "folder1")
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["c1", "c2"])
    expect(out.edges.map((e) => e.id)).toEqual(["e1"])
  })


  it("passes groups and frameOrder through unchanged", () => {
    const c = content([node("a")])
    const out = filterContentByLayer(c, null)
    expect(out.groups).toEqual(c.groups)
    expect(out.frameOrder).toEqual(c.frameOrder)
  })


  it("is a no-op shape for a flat board (all root)", () => {
    const c = content([node("a"), node("b"), node("c")])
    expect(filterContentByLayer(c, null).nodes).toHaveLength(3)
  })
})


describe("buildLayerPath", () => {
  // Board: f1 (root) › f2 (in f1) › leaf (in f2).
  const nodes = [node("f1", null, "Alpha"), node("f2", "f1", "Beta"), node("leaf", "f2", "Leaf")]

  it("returns [] for the root layer", () => {
    expect(buildLayerPath(nodes, null)).toEqual([])
  })

  it("walks parentId up and returns the path root-first", () => {
    expect(buildLayerPath(nodes, "f2")).toEqual([
      { id: "f1", label: "Alpha" },
      { id: "f2", label: "Beta" },
    ])
  })

  it("labels an unlabelled folder as 'Folder'", () => {
    expect(buildLayerPath([node("f1", null)], "f1")).toEqual([{ id: "f1", label: "Folder" }])
  })

  it("is cycle-safe", () => {
    const looped = [node("a", "b", "A"), node("b", "a", "B")]
    expect(buildLayerPath(looped, "a").map((c) => c.id).sort()).toEqual(["a", "b"])
  })
})
