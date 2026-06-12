// Tests for sticky style memory — focused on the edge defaults, which
// silently never persisted before the harness-canvas dead-memo fix.
import { useEffect } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  asEdgeId,
  asNodeId,
  createCanvasStore,
  type CanvasStore,
  type EdgeId,
  type NodeId,
} from "@canvas-harness/core"
import { useStyleMemory, type StyleMemoryApi } from "./use-style-memory"


const STORAGE_KEY = "dim0:harness:style-memory:v1"


/** Drop a free-floating edge into the store and return its id. */
const addFloatingEdge = (store: CanvasStore): EdgeId => {
  const id = asEdgeId(store.generateId())
  store.addEdge({
    id,
    source: { worldPoint: { x: 0, y: 0 } },
    target: { worldPoint: { x: 100, y: 0 } },
    pathStyle: "bezier",
    groups: [],
  })
  return id
}


/** Drop a default rect node into the store and return its id. */
const addRectNode = (store: CanvasStore): NodeId => {
  const id = asNodeId(store.generateId())
  store.addNode({ id, type: "rect", x: 0, y: 0, w: 100, h: 60, angle: 0, groups: [] })
  return id
}


describe("useStyleMemory", () => {
  let container: HTMLDivElement
  let root: Root


  beforeEach(() => {
    window.localStorage.clear()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })


  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })


  it("captures an edge style change live, without a remount, and persists it", () => {
    const store = createCanvasStore()
    let api: StyleMemoryApi | undefined
    const Probe = (): null => {
      api = useStyleMemory(store)
      return null
    }
    act(() => {
      root.render(<Probe />)
    })

    expect(api?.getEdgeStyle()).toBeUndefined()

    const edgeId = addFloatingEdge(store)
    act(() => {
      store.updateEdge(edgeId, { style: { strokeColor: "#ff0000" } })
    })

    // Memory reflects the user's pick mid-session (no reload).
    expect(api?.getEdgeStyle()?.strokeColor).toBe("#ff0000")
    // And it is persisted for the next reload.
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
    expect(persisted.edge?.style?.strokeColor).toBe("#ff0000")
  })


  it("exposes the remembered canonical edge colors via getEdgeStoredColors", () => {
    const store = createCanvasStore()
    let api: StyleMemoryApi | undefined
    const Probe = (): null => {
      api = useStyleMemory(store)
      return null
    }
    act(() => {
      root.render(<Probe />)
    })

    expect(api?.getEdgeStoredColors()).toBeUndefined()

    const edgeId = addFloatingEdge(store)
    act(() => {
      store.updateEdge(edgeId, { style: { strokeColor: "#ff0000", textColor: "#111111" } })
    })

    expect(api?.getEdgeStoredColors()).toEqual({
      strokeColor: "#ff0000",
      textColor: "#111111",
    })
  })


  it("getEdgeStoredColors returns undefined when only non-color edge style changed", () => {
    const store = createCanvasStore()
    let api: StyleMemoryApi | undefined
    const Probe = (): null => {
      api = useStyleMemory(store)
      return null
    }
    act(() => {
      root.render(<Probe />)
    })

    const edgeId = addFloatingEdge(store)
    act(() => {
      store.updateEdge(edgeId, { style: { strokeWidth: 4 } })
    })

    // Width is remembered, but there are no colors to stamp onto a new edge.
    expect(api?.getEdgeStyle()?.strokeWidth).toBe(4)
    expect(api?.getEdgeStoredColors()).toBeUndefined()
  })


  it("captures edge pathStyle changes too", () => {
    const store = createCanvasStore()
    let api: StyleMemoryApi | undefined
    const Probe = (): null => {
      api = useStyleMemory(store)
      return null
    }
    act(() => {
      root.render(<Probe />)
    })

    const edgeId = addFloatingEdge(store)
    act(() => {
      store.updateEdge(edgeId, { pathStyle: "straight" })
    })

    expect(api?.getEdgePathStyle()).toBe("straight")
  })


  it("keeps a stable api identity while its values change — why consumers must read it each render", () => {
    // Regression guard for the dead-memo bug: `arrowDefaults` used to be
    // `useMemo(() => ({ style: api.getEdgeStyle() }), [api])`. Because the
    // api object identity never changes, that memo froze the edge defaults
    // at their mount-time (empty) value and ignored every later restyle.
    // This pins the contract that makes the fix necessary: same api
    // reference, fresh values.
    const store = createCanvasStore()
    let api: StyleMemoryApi | undefined
    const Probe = (): null => {
      api = useStyleMemory(store)
      return null
    }
    act(() => {
      root.render(<Probe />)
    })

    const before = api
    const edgeId = addFloatingEdge(store)
    act(() => {
      store.updateEdge(edgeId, { style: { strokeColor: "#00ff00" } })
    })

    expect(api).toBe(before) // identity unchanged...
    expect(api?.getEdgeStyle()?.strokeColor).toBe("#00ff00") // ...value fresh
  })


  it("a per-render arrowDefaults (the fix) picks up edge restyles", () => {
    const store = createCanvasStore()
    const committed: Array<string | undefined> = []
    const Consumer = (): null => {
      const api = useStyleMemory(store)
      // Mirrors the fixed harness-canvas: recompute every render from the
      // live accessors instead of memoizing on the stable api object.
      const arrowDefaults = { style: api.getEdgeStyle() }
      useEffect(() => {
        committed.push(arrowDefaults.style?.strokeColor)
      })
      return null
    }
    act(() => {
      root.render(<Consumer />)
    })

    const edgeId = addFloatingEdge(store)
    act(() => {
      store.updateEdge(edgeId, { style: { strokeColor: "#123456" } })
    })

    // The latest committed arrowDefaults carries the restyle.
    expect(committed.at(-1)).toBe("#123456")
  })


  it("captures a node style change live (notes already worked — guards against regressing them)", () => {
    const store = createCanvasStore()
    let api: StyleMemoryApi | undefined
    const Probe = (): null => {
      api = useStyleMemory(store)
      return null
    }
    act(() => {
      root.render(<Probe />)
    })

    const nodeId = addRectNode(store)
    act(() => {
      store.updateNode(nodeId, { style: { strokeColor: "#abcdef" } })
    })

    expect(api?.getNodeStyle()?.strokeColor).toBe("#abcdef")
  })
})
