import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { asNodeId, createCanvasStore, type CanvasStore } from "@canvas-harness/core"
import { setBoardThemeMode } from "../theme/theme-mode-ref"
import { useStampNewNodes } from "./use-stamp-new-nodes"


const BOARD_ID = "board-1"


// Add a node the way the agent's write_note does: addNode() directly, no style.
const addNode = (
  store: CanvasStore,
  id: string,
  type: string,
  data: Record<string, unknown> = {},
): void => {
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
      data: { graphUid: BOARD_ID, ...data },
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


  const mount = (store: CanvasStore, rootId: string | null = null): void => {
    const Probe = (): null => {
      useStampNewNodes(store, BOARD_ID, rootId)
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


  it("strips only pending execution data from a pasted image generator", () => {
    const store = createCanvasStore()
    mount(store)
    addNode(store, "g1", "image-generator", {
      properties: {
        imagePrompt: { type: "text", text: "a blue bird" },
        activeGenerationUid: { type: "keyword", value: "gen-existing" },
        imagePendingRequest: { type: "text", text: '{"clientRequestUid":"old"}' },
      },
    })

    const data = store.getNode(asNodeId("g1"))?.data as {
      properties: Record<string, unknown>
    }
    expect(data.properties.imagePrompt).toEqual({ type: "text", text: "a blue bird" })
    expect(data.properties.activeGenerationUid).toEqual({
      type: "keyword",
      value: "gen-existing",
    })
    expect(data.properties.imagePendingRequest).toEqual({
      type: "text",
      text: "",
      searchable: false,
    })
  })


  it("clears a cross-board image asset UID while preserving same-board clones", () => {
    const store = createCanvasStore()
    mount(store)
    addNode(store, "same", "image", {
      properties: { imageAssetUid: { type: "keyword", value: "a".repeat(32) } },
    })
    addNode(store, "foreign", "image", {
      graphUid: "other-board",
      properties: { imageAssetUid: { type: "keyword", value: "b".repeat(32) } },
    })

    const same = store.getNode(asNodeId("same"))?.data as {
      properties: { imageAssetUid: { value: string } }
    }
    const foreign = store.getNode(asNodeId("foreign"))?.data as {
      properties: { imageAssetUid: { value: string } }
    }
    expect(same.properties.imageAssetUid.value).toBe("a".repeat(32))
    expect(foreign.properties.imageAssetUid.value).toBe("")
  })


  it("preserves same-board result clones and clears cross-board associations", () => {
    const store = createCanvasStore()
    mount(store)
    const association = {
      generatedImageMarker: { type: "keyword", value: "immutable-result" },
      imageAssetUid: { type: "keyword", value: "a".repeat(32) },
      generatedImageGenerationUid: { type: "keyword", value: "g".repeat(32) },
      generatedImageGeneratorNodeUid: { type: "keyword", value: "n".repeat(32) },
    }
    addNode(store, "same-result", "generated-image", { properties: association })
    addNode(store, "foreign-result", "generated-image", {
      graphUid: "other-board",
      properties: association,
    })

    const same = store.getNode(asNodeId("same-result"))?.data as {
      properties: typeof association
    }
    const foreign = store.getNode(asNodeId("foreign-result"))?.data as {
      properties: typeof association
    }
    expect(same.properties).toEqual(association)
    expect(foreign.properties.generatedImageMarker).toEqual(association.generatedImageMarker)
    expect(foreign.properties.imageAssetUid.value).toBe("")
    expect(foreign.properties.generatedImageGenerationUid.value).toBe("")
    expect(foreign.properties.generatedImageGeneratorNodeUid.value).toBe("")
  })


  it("preserves asset associations when moving between folders on the same board", () => {
    const store = createCanvasStore()
    mount(store, "target-folder")
    const association = {
      generatedImageMarker: { type: "keyword", value: "immutable-result" },
      imageAssetUid: { type: "keyword", value: "a".repeat(32) },
      generatedImageGenerationUid: { type: "keyword", value: "g".repeat(32) },
      generatedImageGeneratorNodeUid: { type: "keyword", value: "n".repeat(32) },
    }
    addNode(store, "same-board-folder-result", "generated-image", {
      parentId: "source-folder",
      properties: association,
    })

    const data = store.getNode(asNodeId("same-board-folder-result"))?.data as {
      graphUid: string
      parentId: string
      properties: typeof association
    }
    expect(data.graphUid).toBe(BOARD_ID)
    expect(data.parentId).toBe("target-folder")
    expect(data.properties).toEqual(association)
  })
})
