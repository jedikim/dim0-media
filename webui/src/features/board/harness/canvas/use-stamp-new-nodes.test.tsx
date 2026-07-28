import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { asNodeId, createCanvasStore, type CanvasStore } from "@canvas-harness/core"
import { setBoardThemeMode } from "../theme/theme-mode-ref"
import { useStampNewNodes } from "./use-stamp-new-nodes"


const BOARD_ID = "board-1"


// Add a node the way the agent's write_note does: addNode() directly, no style.
const addNode = (store: CanvasStore, id: string, type: string): void => {
  act(() => {
    store.addNode({
      id: asNodeId(id),
      type,
      x: 0,
      y: 0,
      w: 240,
      h: 120,
      angle: 0,
      groups: [],
      content: "a long body that grow-to-fit would expand the node to",
      // graphUid matches scope so the rescope branch doesn't fire — we want to
      // prove autoFit alone triggers the stamp.
      data: { graphUid: BOARD_ID },
    } as unknown as Parameters<CanvasStore["addNode"]>[0])
  })
}


const autoFitOf = (store: CanvasStore, id: string): boolean | undefined =>
  store.getNode(asNodeId(id))?.style?.autoFit


describe("useStampNewNodes — autoFit normalization", () => {
  let container: HTMLDivElement
  let root: Root


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    setBoardThemeMode("light")
  })


  const mount = (store: CanvasStore): void => {
    const Probe = (): null => {
      useStampNewNodes(store, BOARD_ID, null)
      return null
    }
    act(() => root.render(<Probe />))
  }


  it("forces autoFit:false on locally-created custom nodes (sheet, mini-app)", () => {
    const store = createCanvasStore()
    mount(store)
    addNode(store, "s1", "sheet")
    addNode(store, "m1", "mini-app")
    expect(autoFitOf(store, "s1")).toBe(false)
    expect(autoFitOf(store, "m1")).toBe(false)
  })


  it("leaves a rectangle's autoFit untouched (it should grow-to-fit)", () => {
    const store = createCanvasStore()
    mount(store)
    addNode(store, "r1", "rect")
    expect(autoFitOf(store, "r1")).not.toBe(false)
  })
})
