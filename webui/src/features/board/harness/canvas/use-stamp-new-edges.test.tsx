// Tests for the edge-stamp helpers + paste subscriber. Sticky-color
// inheritance on a fresh arrow-drawn edge is now produced by the
// arrowDefaults factory wired in `harness-canvas` (canvas-harness
// 0.1.24+), so the unit-level behavior worth pinning here is the
// resolver helper and the subscriber's paste-preservation path.
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
  attachedNodeId,
  orderedImageReferences,
  useImageReferenceTargetLock,
  useOrderedImageReferences,
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
    type: "image" | "image-generator" | "generated-image" | "text",
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
    providedId?: EdgeId,
  ): EdgeId => {
    const id = providedId ?? asEdgeId(store.generateId())
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


  it("stamps a pointer-style reference in its initial edge.add batch", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "generator-target", "image-generator")
    const batches: Parameters<CanvasStore["applyBatch"]>[0][] = []
    const unsubscribe = store.subscribe("change", (batch) => batches.push(batch))

    let edgeId: EdgeId
    act(() => {
      edgeId = addAttachedEdge(store, "image-1", "generator-target")
    })
    unsubscribe()

    expect(batches).toHaveLength(1)
    expect(batches[0]?.ops).toEqual([
      expect.objectContaining({
        type: "edge.add",
        edge: expect.objectContaining({
          id: edgeId!,
          data: expect.objectContaining({
            imageReference: true,
            imageReferenceOrdinal: 0,
          }),
        }),
      }),
    ])
    expect(store.getInteractionState().mode).toBe("idle")
  })


  it("marks immutable generated-image sources as ordinary ordered references", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "generated-result", "generated-image")
    addNode(store, "generator-target", "image-generator")

    act(() => {
      addAttachedEdge(store, "generated-result", "generator-target")
    })

    expect(orderedImageReferences(store, asNodeId("generator-target"))).toEqual([
      expect.objectContaining({
        sourceNodeId: asNodeId("generated-result"),
        ordinal: 0,
      }),
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


  it("allows one source node to reference different generators", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "generator-target", "image-generator")
    addNode(store, "generator-other", "image-generator")

    act(() => {
      addAttachedEdge(store, "image-1", "generator-target")
      addAttachedEdge(store, "image-1", "generator-other")
    })

    expect(orderedImageReferences(store, asNodeId("generator-target"))).toHaveLength(1)
    expect(orderedImageReferences(store, asNodeId("generator-other"))).toHaveLength(1)
    expect(store.getAllEdges()).toHaveLength(2)
  })


  it("allows distinct source nodes that resolve to the same asset", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "image-2", "image")
    addNode(store, "generator-target", "image-generator")
    for (const nodeId of ["image-1", "image-2"]) {
      const node = store.getNode(asNodeId(nodeId))!
      store.updateNode(node.id, {
        data: {
          ...(node.data ?? {}),
          properties: {
            imageAssetUid: { type: "keyword", value: "a".repeat(32) },
          },
        },
      })
    }

    act(() => {
      addAttachedEdge(store, "image-1", "generator-target")
      addAttachedEdge(store, "image-2", "generator-target")
    })

    expect(orderedImageReferences(store, asNodeId("generator-target"))
      .map((reference) => String(reference.sourceNodeId)))
      .toEqual(["image-1", "image-2"])
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
    const batches: string[][] = []
    const unsubscribe = store.subscribe("change", (batch) => {
      batches.push(batch.ops.map((op) => op.type))
    })

    act(() => {
      addAttachedEdge(store, "image-1", "generator-target")
    })
    unsubscribe()

    expect(store.getAllEdges()).toEqual([])
    expect(batches).toEqual([])
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


  it("classifies a valid reconnect and clears metadata after an invalid reconnect", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "text-1", "text")
    addNode(store, "text-2", "text")
    addNode(store, "generator-target", "image-generator")
    const edgeId = addAttachedEdge(store, "text-1", "text-2")

    act(() => store.updateEdge(edgeId, {
      source: { nodeId: asNodeId("image-1"), localOffset: { x: 0, y: 0 } },
      target: { nodeId: asNodeId("generator-target"), localOffset: { x: 0, y: 0 } },
    }))
    expect(orderedImageReferences(store, asNodeId("generator-target")))
      .toEqual([expect.objectContaining({ sourceNodeId: asNodeId("image-1"), ordinal: 0 })])

    act(() => store.updateEdge(edgeId, {
      source: { nodeId: asNodeId("text-1"), localOffset: { x: 0, y: 0 } },
    }))
    expect(orderedImageReferences(store, asNodeId("generator-target"))).toEqual([])
    expect(store.getEdge(edgeId)?.data).toEqual(expect.objectContaining({
      imageReference: null,
      imageReferenceOrdinal: null,
    }))
  })


  it("assigns a new target ordinal when a marked edge moves generators", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "image-2", "image")
    addNode(store, "generator-target", "image-generator")
    addNode(store, "generator-other", "image-generator")
    let moving: EdgeId
    act(() => {
      moving = addAttachedEdge(store, "image-1", "generator-target")
      addAttachedEdge(store, "image-2", "generator-other")
    })

    act(() => store.updateEdge(moving!, {
      target: { nodeId: asNodeId("generator-other"), localOffset: { x: 0, y: 0 } },
    }))

    expect(orderedImageReferences(store, asNodeId("generator-target"))).toEqual([])
    expect(orderedImageReferences(store, asNodeId("generator-other")).map((reference) => [
      String(reference.sourceNodeId),
      reference.ordinal,
    ])).toEqual([
      ["image-2", 0],
      ["image-1", 1],
    ])
  })


  it("removes an unlocked reference edge and refreshes the ordered list", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "generator-target", "image-generator")
    const edgeId = addAttachedEdge(store, "image-1", "generator-target")
    const batches: string[][] = []
    const unsubscribe = store.subscribe("change", (batch) => {
      batches.push(batch.ops.map((op) => op.type))
    })

    act(() => store.removeEdge(edgeId))
    unsubscribe()

    expect(store.getEdge(edgeId)).toBeUndefined()
    expect(orderedImageReferences(store, asNodeId("generator-target"))).toEqual([])
    expect(batches).toEqual([["edge.remove"]])
  })


  it("reverts a local reconnect and direct delete while the reference target is locked", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "text-1", "text")
    addNode(store, "generator-target", "image-generator")
    let edgeId: EdgeId
    act(() => {
      edgeId = addAttachedEdge(store, "image-1", "generator-target")
    })
    mountStamp(store, { targetLocked: true })
    const batches: string[][] = []
    const unsubscribe = store.subscribe("change", (batch) => {
      batches.push(batch.ops.map((op) => op.type))
    })

    act(() => store.updateEdge(edgeId!, {
      target: { nodeId: asNodeId("text-1"), localOffset: { x: 0, y: 0 } },
    }))
    expect(attachedNodeId(store.getEdge(edgeId!)!.target)).toBe(asNodeId("generator-target"))
    expect(orderedImageReferences(store, asNodeId("generator-target"))).toHaveLength(1)

    act(() => store.removeEdge(edgeId!))
    unsubscribe()
    expect(store.getEdge(edgeId!)).toBeDefined()
    expect(orderedImageReferences(store, asNodeId("generator-target"))).toHaveLength(1)
    expect(batches).toEqual([])
  })


  it("does not pretend a local lock can reject a remote reconnect", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "text-1", "text")
    addNode(store, "generator-target", "image-generator")
    let edgeId: EdgeId
    act(() => {
      edgeId = addAttachedEdge(store, "image-1", "generator-target")
    })
    mountStamp(store, { targetLocked: true })

    act(() => store.applyOp({
      type: "edge.update",
      id: edgeId!,
      patch: {
        target: { nodeId: asNodeId("text-1"), localOffset: { x: 0, y: 0 } },
      },
      prev: {
        target: { nodeId: asNodeId("generator-target"), localOffset: { x: 50, y: 50 } },
      },
    }, { origin: "remote" }))

    expect(attachedNodeId(store.getEdge(edgeId!)!.target)).toBe(asNodeId("text-1"))
    expect(orderedImageReferences(store, asNodeId("generator-target"))).toEqual([])
  })


  it("performs no viewer reference metadata mutation", () => {
    const store = createCanvasStore()
    mountStamp(store, { canEdit: false })
    addNode(store, "image-1", "image")
    addNode(store, "image-2", "image")
    const batches: string[][] = []
    const unsubscribe = store.subscribe("change", (batch) => {
      batches.push(batch.ops.map((op) => op.type))
    })

    let edgeId: EdgeId
    act(() => {
      edgeId = addAttachedEdge(store, "image-1", "image-2", {
        imageReference: true,
        imageReferenceOrdinal: 4,
      })
    })
    unsubscribe()

    expect(batches).toEqual([["edge.add"]])
    expect(store.getEdge(edgeId!)?.data).toEqual(expect.objectContaining({
      imageReference: true,
      imageReferenceOrdinal: 4,
    }))
  })


  it("uses the core edge-first node removal cascade and never restores the reference", () => {
    const store = createCanvasStore()
    mountStamp(store)
    addNode(store, "image-1", "image")
    addNode(store, "generator-target", "image-generator")
    let edgeId: EdgeId
    act(() => {
      edgeId = addAttachedEdge(store, "image-1", "generator-target")
    })
    mountStamp(store, { targetLocked: true })
    const removalBatches: Parameters<CanvasStore["applyBatch"]>[0][] = []
    const unsubscribe = store.subscribe("change", (batch) => {
      if (batch.ops.some((op) => op.type === "node.remove")) removalBatches.push(batch)
    })

    act(() => store.removeNode(asNodeId("image-1")))
    unsubscribe()

    const [removalBatch] = removalBatches
    expect(removalBatch?.ops.map((op) => op.type)).toEqual(["edge.remove", "node.remove"])
    expect(store.getAllEdges()).toEqual([])
    expect(orderedImageReferences(store, asNodeId("generator-target"))).toEqual([])

    const reloaded = createCanvasStore()
    addNode(reloaded, "image-1", "image")
    addNode(reloaded, "generator-target", "image-generator")
    addAttachedEdge(reloaded, "image-1", "generator-target", {
      imageReference: true,
      imageReferenceOrdinal: 0,
    }, edgeId!)
    reloaded.applyBatch({ ...removalBatch!, origin: "remote" })
    expect(reloaded.getAllEdges()).toEqual([])
    expect(orderedImageReferences(reloaded, asNodeId("generator-target"))).toEqual([])
  })


  it("rescans ordered references only for edge operation batches", () => {
    const store = createCanvasStore()
    addNode(store, "image-1", "image")
    addNode(store, "generator-target", "image-generator")
    const getAllEdges = vi.spyOn(store, "getAllEdges")
    const Probe = (): null => {
      useOrderedImageReferences(store, asNodeId("generator-target"))
      return null
    }
    act(() => root.render(<Probe />))
    getAllEdges.mockClear()

    act(() => store.updateNode(asNodeId("image-1"), { x: 10 }))
    expect(getAllEdges).not.toHaveBeenCalled()

    act(() => addAttachedEdge(store, "image-1", "generator-target", {
      imageReference: true,
      imageReferenceOrdinal: 0,
    }))
    expect(getAllEdges).toHaveBeenCalledTimes(1)
  })
})
