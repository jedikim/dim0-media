// Tests for the edge-stamp helpers + paste subscriber. Sticky-color
// inheritance on a fresh arrow-drawn edge is now produced by the
// arrowDefaults factory wired in `harness-canvas` (canvas-harness
// 0.1.24+), so the unit-level behavior worth pinning here is the
// resolver helper and the subscriber's paste-preservation path.
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  asEdgeId,
  asNodeId,
  createCanvasStore,
  type CanvasStore,
  type EdgeId,
} from "@canvas-harness/core"
import {
  CANONICAL_EDGE_COLORS,
  resolveStoredEdgeColors,
  useStampNewEdges,
} from "./use-stamp-new-edges"
import { type StoredEdgeColors } from "../theme/color-adapter"
import { setBoardThemeMode } from "../theme/theme-mode-ref"
import {
  orderedImageReferences,
  useImageReferenceTargetLock,
} from "../image-reference-edges"


const BOARD_ID = "board-1"


describe("resolveStoredEdgeColors", () => {
  it("returns the remembered colors verbatim when both fields are set", () => {
    const remembered = { strokeColor: "#ef4444", textColor: "#111111" }
    expect(resolveStoredEdgeColors(remembered)).toEqual(remembered)
  })


  it("falls back to canonical defaults when nothing is remembered", () => {
    expect(resolveStoredEdgeColors(undefined)).toEqual(CANONICAL_EDGE_COLORS)
  })


  it("fills only the unpicked field with the canonical default", () => {
    expect(resolveStoredEdgeColors({ strokeColor: "#00ff00" })).toEqual({
      strokeColor: "#00ff00",
      textColor: CANONICAL_EDGE_COLORS.textColor,
    })
  })
})


describe("useStampNewEdges — paste preservation", () => {
  let container: HTMLDivElement
  let root: Root


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })


  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    setBoardThemeMode("light")
  })


  const mountStamp = (
    store: CanvasStore,
    {
      canEdit = true,
      local = false,
      targetLocked = false,
    }: { canEdit?: boolean; local?: boolean; targetLocked?: boolean } = {},
  ): void => {
    const Probe = (): null => {
      useImageReferenceTargetLock(asNodeId("generator-target"), targetLocked)
      useStampNewEdges(store, BOARD_ID, null, canEdit, local)
      return null
    }
    act(() => {
      root.render(<Probe />)
    })
  }


  const addNode = (
    store: CanvasStore,
    id: string,
    type: "image" | "image-generator",
  ): void => {
    store.addNode({
      id: asNodeId(id),
      type,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      angle: 0,
      z: 0,
      groups: [],
      data: { graphUid: BOARD_ID, properties: {} },
    })
  }


  const addAttachedEdge = (
    store: CanvasStore,
    source: string,
    target: string,
    data: Record<string, unknown> = {},
  ): EdgeId => {
    const id = asEdgeId(store.generateId())
    store.addEdge({
      id,
      source: { nodeId: asNodeId(source), localOffset: { x: 50, y: 50 } },
      target: { nodeId: asNodeId(target), localOffset: { x: 50, y: 50 } },
      pathStyle: "bezier",
      z: 0,
      groups: [],
        data: {
          version: 1,
          createdAt: new Date().toISOString(),
          graphUid: BOARD_ID,
          ...data,
        },
    })
    return id
  }


  it("preserves a pasted edge's _storedColors when scope + theme already match", () => {
    const store = createCanvasStore()
    mountStamp(store)

    const pasted: StoredEdgeColors = { strokeColor: "#abcdef", textColor: "#fedcba" }
    let edgeId: EdgeId | undefined
    act(() => {
      edgeId = asEdgeId(store.generateId())
      store.addEdge({
        id: edgeId,
        source: { worldPoint: { x: 0, y: 0 } },
        target: { worldPoint: { x: 100, y: 0 } },
        pathStyle: "bezier",
        groups: [],
        style: { ...pasted },
        data: {
          version: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          graphUid: BOARD_ID,
          _storedColors: pasted,
        },
      })
    })
    const edge = store.getEdge(edgeId!)

    expect((edge?.data as { _storedColors?: StoredEdgeColors })?._storedColors)
      .toEqual(pasted)
  })


  it("marks image/generator references in connection order", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "generator-source", "image-generator")
    addNode(store, "generator-target", "image-generator")

    act(() => {
      addAttachedEdge(store, "image-1", "generator-target")
      addAttachedEdge(store, "generator-source", "generator-target")
    })

    const references = orderedImageReferences(store, asNodeId("generator-target"))
    expect(references.map((reference) => [
      String(reference.sourceNodeId),
      reference.ordinal,
    ])).toEqual([
      ["image-1", 0],
      ["generator-source", 1],
    ])
  })


  it("blocks only exact duplicate source-target references", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "image-2", "image")
    addNode(store, "generator-target", "image-generator")

    act(() => {
      addAttachedEdge(store, "image-1", "generator-target")
      addAttachedEdge(store, "image-1", "generator-target")
      addAttachedEdge(store, "image-2", "generator-target")
    })

    const references = orderedImageReferences(store, asNodeId("generator-target"))
    expect(references.map((reference) => String(reference.sourceNodeId)))
      .toEqual(["image-1", "image-2"])
    expect(store.getAllEdges()).toHaveLength(2)
  })


  it("does not classify fresh local-board or viewer edges as references", () => {
    for (const options of [{ local: true }, { canEdit: false }]) {
      const store = createCanvasStore()
      mountStamp(store, options)
      addNode(store, "image-1", "image")
      addNode(store, "generator-target", "image-generator")
      act(() => {
        addAttachedEdge(store, "image-1", "generator-target")
      })
      expect(orderedImageReferences(store, asNodeId("generator-target"))).toEqual([])
    }
  })


  it("rejects a new local reference while the target inputs are locked", () => {
    const store = createCanvasStore()
    mountStamp(store, { targetLocked: true })
    addNode(store, "image-1", "image")
    addNode(store, "generator-target", "image-generator")

    act(() => {
      addAttachedEdge(store, "image-1", "generator-target")
    })

    expect(store.getAllEdges()).toEqual([])
  })


  it("explicitly clears a pasted marker from an invalid relationship", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "image-2", "image")

    let edgeId: EdgeId | undefined
    act(() => {
      edgeId = addAttachedEdge(store, "image-1", "image-2", {
        imageReference: true,
        imageReferenceOrdinal: 4,
      })
    })

    expect(store.getEdge(edgeId!)?.data).toEqual(expect.objectContaining({
      imageReference: null,
      imageReferenceOrdinal: null,
    }))
  })
})
