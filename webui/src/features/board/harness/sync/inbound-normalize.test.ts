import { afterEach, describe, expect, it } from "vitest"
import { asBatchId, asClientId, asEdgeId, asNodeId } from "@canvas-harness/core"
import type { Edge, Node, OpBatch } from "@canvas-harness/core"
import { addNode, freshStore } from "@/test/canvas"
import { setBoardThemeMode } from "@/features/board/harness/theme/theme-mode-ref"
import { normalizeInboundBatch } from "./inbound-normalize"


afterEach(() => setBoardThemeMode("light"))


const batch = (ops: OpBatch["ops"]): OpBatch => ({
  id: asBatchId("b"),
  clientId: asClientId("peer"),
  ts: 0,
  origin: "remote",
  ops,
})


const storedColors = { backgroundColor: "#ffeeee", strokeColor: "#ff0000", textColor: "#111111" }


/** A node.add op carrying canonical stored colors (as the relay ships them). */
const nodeAddWithColors = (id: string) => ({
  type: "node.add" as const,
  node: {
    id: asNodeId(id),
    type: "rect",
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    angle: 0,
    groups: [],
    style: {},
    data: { _storedColors: storedColors },
  } as unknown as Node,
})


describe("normalizeInboundBatch", () => {
  it("projects stored colors to the local theme style (light = identity)", () => {
    setBoardThemeMode("light")
    const store = freshStore("me")
    const b = batch([nodeAddWithColors("n1")])

    normalizeInboundBatch(b, store)

    const style = (b.ops[0] as { node: Node }).node.style as Record<string, string>
    expect(style.backgroundColor).toBe("#ffeeee")
    expect(style.strokeColor).toBe("#ff0000")
    expect(style.textColor).toBe("#111111")
  })


  it("re-themes differently in dark mode", () => {
    const store = freshStore("me")
    const light = batch([nodeAddWithColors("n1")])
    setBoardThemeMode("light")
    normalizeInboundBatch(light, store)

    const dark = batch([nodeAddWithColors("n1")])
    setBoardThemeMode("dark")
    normalizeInboundBatch(dark, store)

    const lightBg = ((light.ops[0] as { node: Node }).node.style as Record<string, string>).backgroundColor
    const darkBg = ((dark.ops[0] as { node: Node }).node.style as Record<string, string>).backgroundColor
    expect(darkBg).not.toBe(lightBg) // dark mode projects the canonical hex
  })


  it("recovers cubic controls from a _midpoint and strips it", () => {
    const store = freshStore("me")
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
        _midpoint: { x: 50, y: 120 },
      } as unknown as Edge,
    }])

    normalizeInboundBatch(b, store)

    const edge = (b.ops[0] as { edge: Edge & { _midpoint?: unknown; control?: unknown } }).edge
    expect(edge.control).toBeDefined()
    expect((edge.control as unknown[]).length).toBe(2)
    expect(edge._midpoint).toBeUndefined()
  })


  it("defaults a missing localOffset on an attached endpoint to the node center", () => {
    const store = freshStore("me")
    addNode(store, "n1") // 100x50 → center (50, 25)
    const b = batch([{
      type: "edge.add",
      edge: {
        id: asEdgeId("e1"),
        source: { nodeId: asNodeId("n1") }, // no localOffset
        target: { worldPoint: { x: 5, y: 5 } },
        pathStyle: "bezier",
        groups: [],
        data: {},
      } as unknown as Edge,
    }])

    normalizeInboundBatch(b, store)

    const source = (b.ops[0] as { edge: Edge }).edge.source as { localOffset: { x: number; y: number } }
    expect(source.localOffset).toEqual({ x: 50, y: 25 })
  })
})
