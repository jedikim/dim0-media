import { beforeEach, describe, expect, it } from "vitest"
import { asNodeId } from "@canvas-harness/core"
import { addNode, freshStore, resetIdb } from "@/test/canvas"
import { NOTE_TAIL_GAP, beneathBorderOrigin } from "./beneath-border"


beforeEach(() => resetIdb())


describe("beneathBorderOrigin", () => {
  it("returns (0,0) on an empty board", () => {
    expect(beneathBorderOrigin(freshStore("c"))).toEqual({ x: 0, y: 0 })
  })

  it("left-aligns to the leftmost node, one gap below the lowest bottom edge", () => {
    const store = freshStore("c")
    addNode(store, "a")
    addNode(store, "b")
    store.updateNode(asNodeId("a"), { x: 40, y: 0, w: 200, h: 100 }) // bottom 100, leftmost x
    store.updateNode(asNodeId("b"), { x: 300, y: 60, w: 200, h: 180 }) // bottom 240
    expect(beneathBorderOrigin(store)).toEqual({ x: 40, y: 240 + NOTE_TAIL_GAP })
  })
})
