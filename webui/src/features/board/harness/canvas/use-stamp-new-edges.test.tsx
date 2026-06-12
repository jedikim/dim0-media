// Tests for the edge-creation stamp, focused on sticky-color inheritance:
// a freshly-drawn edge must adopt the user's last-picked colors (canonical),
// projected for the current theme, while paste/scope handling stays intact.
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  asEdgeId,
  createCanvasStore,
  type CanvasStore,
  type EdgeId,
} from "@canvas-harness/core"
import { useStampNewEdges } from "./use-stamp-new-edges"
import { adaptEdgeColors, type StoredEdgeColors } from "../theme/color-adapter"
import { setBoardThemeMode } from "../theme/theme-mode-ref"


const BOARD_ID = "board-1"
const CANONICAL = { strokeColor: "#292524", textColor: "#000000" }


/** Add an edge the way the lib's arrow tool does: a `style`, but no `data`. */
const drawEdge = (store: CanvasStore, style?: Record<string, unknown>): EdgeId => {
  const id = asEdgeId(store.generateId())
  store.addEdge({
    id,
    source: { worldPoint: { x: 0, y: 0 } },
    target: { worldPoint: { x: 100, y: 0 } },
    pathStyle: "bezier",
    groups: [],
    ...(style ? { style } : {}),
  })
  return id
}


describe("useStampNewEdges — sticky color inheritance", () => {
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


  /** Mount the stamp with a fixed remembered-color getter. */
  const mountStamp = (
    store: CanvasStore,
    remembered: StoredEdgeColors | undefined,
  ): void => {
    const Probe = (): null => {
      useStampNewEdges(store, BOARD_ID, null, () => remembered)
      return null
    }
    act(() => {
      root.render(<Probe />)
    })
  }


  it("stamps a freshly-drawn edge with the remembered canonical colors (light mode)", () => {
    const store = createCanvasStore()
    const remembered = { strokeColor: "#ef4444", textColor: "#111111" }
    mountStamp(store, remembered)

    let edgeId: EdgeId | undefined
    act(() => {
      edgeId = drawEdge(store)
    })
    const edge = store.getEdge(edgeId!)

    // Canonical source-of-truth captured...
    expect((edge?.data as { _storedColors?: StoredEdgeColors })?._storedColors)
      .toEqual(remembered)
    // ...and painted as display (light = identity).
    expect(edge?.style?.strokeColor).toBe("#ef4444")
    expect(edge?.style?.textColor).toBe("#111111")
  })


  it("projects the remembered colors to dark-mode display while keeping canonical truth", () => {
    setBoardThemeMode("dark")
    const store = createCanvasStore()
    const remembered = { strokeColor: "#ef4444", textColor: "#111111" }
    mountStamp(store, remembered)

    let edgeId: EdgeId | undefined
    act(() => {
      edgeId = drawEdge(store)
    })
    const edge = store.getEdge(edgeId!)
    const expectedDisplay = adaptEdgeColors(remembered, "dark")

    // Stored truth stays canonical (light) — this is what hits the DB / collab.
    expect((edge?.data as { _storedColors?: StoredEdgeColors })?._storedColors)
      .toEqual(remembered)
    // Painted style is the dark-adapted projection.
    expect(edge?.style?.strokeColor).toBe(expectedDisplay.strokeColor)
    expect(edge?.style?.textColor).toBe(expectedDisplay.textColor)
  })


  it("falls back to canonical defaults when nothing is remembered", () => {
    const store = createCanvasStore()
    mountStamp(store, undefined)

    let edgeId: EdgeId | undefined
    act(() => {
      edgeId = drawEdge(store)
    })
    const edge = store.getEdge(edgeId!)

    expect((edge?.data as { _storedColors?: StoredEdgeColors })?._storedColors)
      .toEqual(CANONICAL)
  })


  it("merges canonical for the field the user never picked", () => {
    const store = createCanvasStore()
    // Only a stroke color was ever picked; label color should stay canonical.
    mountStamp(store, { strokeColor: "#00ff00" })

    let edgeId: EdgeId | undefined
    act(() => {
      edgeId = drawEdge(store)
    })
    const edge = store.getEdge(edgeId!)

    expect((edge?.data as { _storedColors?: StoredEdgeColors })?._storedColors)
      .toEqual({ strokeColor: "#00ff00", textColor: CANONICAL.textColor })
  })


  it("does not override an edge that already carries its own _storedColors (paste)", () => {
    const store = createCanvasStore()
    const remembered = { strokeColor: "#ef4444", textColor: "#111111" }
    mountStamp(store, remembered)

    // A pasted edge: already initialized + scoped + carrying source colors.
    const pasted = { strokeColor: "#abcdef", textColor: "#fedcba" }
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

    // Source colors preserved — sticky memory must not clobber a paste.
    expect((edge?.data as { _storedColors?: StoredEdgeColors })?._storedColors)
      .toEqual(pasted)
  })
})
