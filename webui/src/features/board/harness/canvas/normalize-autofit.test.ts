// Receiver-side guard: incoming remote ops for preview-rendered custom
// types (sheet, etc.) must carry `style.autoFit = false`, so an agent
// sheet from an un-upgraded backend can't grow unbounded on the next edit.
import { describe, expect, it } from "vitest"
import {
  asNodeId,
  createCanvasStore,
  type CanvasStore,
  type Node,
  type Op,
  type OpBatch,
} from "@canvas-harness/core"
import { normalizeBatchAutoFit } from "./normalize-autofit"


/** Wrap ops in a minimal remote batch — the normalizer only reads `ops`. */
const remoteBatch = (ops: Op[]): OpBatch =>
  ({ ops } as unknown as OpBatch)


/** A bare node.add op, the way an agent-broadcast wire node arrives. */
const addOp = (type: string, style?: Record<string, unknown>): Op =>
  ({
    type: "node.add",
    node: {
      id: asNodeId("n-" + type),
      type,
      x: 0,
      y: 0,
      w: 560,
      h: 320,
      angle: 0,
      z: 0,
      groups: [],
      content: "",
      ...(style ? { style } : {}),
    } as unknown as Node,
  } as Op)


describe("normalizeBatchAutoFit", () => {
  const store: CanvasStore = createCanvasStore()


  it("forces autoFit:false on an incoming sheet node.add with no style", () => {
    const batch = remoteBatch([addOp("sheet")])
    normalizeBatchAutoFit(batch, store)
    const op = batch.ops[0]
    expect(op.type === "node.add" && op.node.style?.autoFit).toBe(false)
  })


  it("preserves other style fields while adding autoFit:false", () => {
    const batch = remoteBatch([addOp("sheet", { strokeColor: "#abcdef" })])
    normalizeBatchAutoFit(batch, store)
    const op = batch.ops[0]
    if (op.type !== "node.add") throw new Error("expected node.add")
    expect(op.node.style?.autoFit).toBe(false)
    expect(op.node.style?.strokeColor).toBe("#abcdef")
  })


  it("leaves built-in primitive node.add untouched", () => {
    const batch = remoteBatch([addOp("rect")])
    normalizeBatchAutoFit(batch, store)
    const op = batch.ops[0]
    expect(op.type === "node.add" && op.node.style?.autoFit).toBeUndefined()
  })


  it("covers every autofit-disabled custom type on node.add", () => {
    for (const type of [
      "sheet",
      "code-sandbox",
      "widget",
      "mini-app",
      "generated-image",
      "folder",
      "document",
    ]) {
      const batch = remoteBatch([addOp(type)])
      normalizeBatchAutoFit(batch, store)
      const op = batch.ops[0]
      expect(op.type === "node.add" && op.node.style?.autoFit).toBe(false)
    }
  })


  it("injects autoFit:false on a style-bearing node.update for an existing sheet", () => {
    const s = createCanvasStore()
    const id = asNodeId("sheet-1")
    s.addNode({
      id,
      type: "sheet",
      x: 0,
      y: 0,
      w: 560,
      h: 320,
      angle: 0,
      z: 0,
      groups: [],
      content: "",
      style: { autoFit: false },
    } as unknown as Parameters<typeof s.addNode>[0])

    const batch = remoteBatch([
      { type: "node.update", id, patch: { style: { strokeColor: "#111" } } } as Op,
    ])
    normalizeBatchAutoFit(batch, s)
    const op = batch.ops[0]
    if (op.type !== "node.update") throw new Error("expected node.update")
    expect((op.patch as Partial<Node>).style?.autoFit).toBe(false)
  })


  it("leaves a node.update with no style patch untouched (no style key created)", () => {
    const s = createCanvasStore()
    const id = asNodeId("sheet-2")
    s.addNode({
      id,
      type: "sheet",
      x: 0,
      y: 0,
      w: 560,
      h: 320,
      angle: 0,
      z: 0,
      groups: [],
      content: "",
      style: { autoFit: false },
    } as unknown as Parameters<typeof s.addNode>[0])

    const batch = remoteBatch([
      { type: "node.update", id, patch: { x: 50 } } as Op,
    ])
    normalizeBatchAutoFit(batch, s)
    const op = batch.ops[0]
    if (op.type !== "node.update") throw new Error("expected node.update")
    expect((op.patch as Partial<Node>).style).toBeUndefined()
  })
})
