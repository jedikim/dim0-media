import { describe, expect, it } from "vitest"
import type { BatchId, ClientId, Node, NodeId, Op } from "@canvas-harness/core"
import type { NoteNodeData } from "@/features/board/harness/convert/note-to-node"
import type { OplogRecord } from "@/features/board/persist/local/idb"
import {
  BOARD_DRIFT_CHARS,
  BOARD_DRIFT_DAYS,
  BOARD_DRIFT_NODES,
  boardDriftSince,
  shouldDerivePurpose,
} from "./board-drift"


const mkNode = (id: string, opts: { label?: string; content?: string } = {}): Node => {
  const data: NoteNodeData = {
    noteType: "note",
    styleType: "rectangle",
    version: 1,
    graphUid: "g",
    label: opts.label !== undefined ? { markdown: opts.label } : undefined,
    properties: {},
  }
  return { id: id as NodeId, type: "rect", x: 0, y: 0, w: 100, h: 100, angle: 0, z: 0, groups: [], content: opts.content, data }
}


const rec = (seq: number, ops: Op[]): OplogRecord => ({
  boardId: "b",
  seq,
  batch: { id: "x" as BatchId, clientId: "c" as ClientId, ts: 0, origin: "local", ops },
})


const addOp = (id: string, opts?: { label?: string; content?: string }): Op => ({ type: "node.add", node: mkNode(id, opts) }) as Op
const updOp = (id: string, patch: Record<string, unknown>): Op => ({ type: "node.update", id: id as NodeId, patch, prev: {} }) as unknown as Op
const rmOp = (id: string): Op => ({ type: "node.remove", node: mkNode(id) }) as Op


const DAY_MS = 86_400_000


describe("boardDriftSince", () => {
  it("sums content mass of added nodes (label + content)", () => {
    const drift = boardDriftSince([rec(1, [addOp("n1", { label: "hi", content: "world!" })])]) // 2 + 6
    expect(drift.charsChanged).toBe(8)
    expect(drift.nodesTouched).toBe(1)
  })


  it("counts an update's TEXT content mass and the node as touched", () => {
    const drift = boardDriftSince([rec(1, [updOp("n1", { content: "abcd" })])])
    expect(drift.charsChanged).toBe(4) // the content text, not the JSON envelope
    expect(drift.nodesTouched).toBe(1)
  })


  it("ignores a layout-only patch's content mass (position churn is not drift)", () => {
    const drift = boardDriftSince([rec(1, [updOp("n1", { position: { x: 10, y: 20 } })])])
    expect(drift.charsChanged).toBe(0) // no text changed
    expect(drift.nodesTouched).toBe(1) // still structural churn
  })


  it("counts a removed node as structural churn (touched) but no content mass", () => {
    const drift = boardDriftSince([rec(1, [rmOp("n1")])])
    expect(drift.charsChanged).toBe(0)
    expect(drift.nodesTouched).toBe(1)
  })


  it("counts distinct nodes once across ops (add then update same node)", () => {
    const drift = boardDriftSince([rec(1, [addOp("n1", { content: "abc" })]), rec(2, [updOp("n1", { content: "xyz" })])])
    expect(drift.nodesTouched).toBe(1)
  })


  it("ignores non-node ops", () => {
    const edgeOp = { type: "edge.add", edge: { id: "e1" } } as unknown as Op
    expect(boardDriftSince([rec(1, [edgeOp])])).toEqual({ charsChanged: 0, nodesTouched: 0 })
  })
})


describe("shouldDerivePurpose", () => {
  const now = 1_000 * DAY_MS
  const fresh = { context: "a purpose", contextDerivedAt: now }


  it("is true when the purpose was never derived", () => {
    expect(shouldDerivePurpose({}, { charsChanged: 0, nodesTouched: 0 }, now)).toBe(true)
  })


  it("is true when content mass changed past the char threshold", () => {
    expect(shouldDerivePurpose(fresh, { charsChanged: BOARD_DRIFT_CHARS, nodesTouched: 0 }, now)).toBe(true)
  })


  it("is true when enough distinct nodes were touched (covers deletes)", () => {
    expect(shouldDerivePurpose(fresh, { charsChanged: 0, nodesTouched: BOARD_DRIFT_NODES }, now)).toBe(true)
  })


  it("is true when stale past the time floor", () => {
    const old = { context: "p", contextDerivedAt: now - BOARD_DRIFT_DAYS * DAY_MS }
    expect(shouldDerivePurpose(old, { charsChanged: 0, nodesTouched: 0 }, now)).toBe(true)
  })


  it("is false when a derived purpose is under every threshold", () => {
    expect(shouldDerivePurpose(fresh, { charsChanged: BOARD_DRIFT_CHARS - 1, nodesTouched: BOARD_DRIFT_NODES - 1 }, now)).toBe(false)
  })
})
