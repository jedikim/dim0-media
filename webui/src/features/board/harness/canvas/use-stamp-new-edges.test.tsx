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


  const mountStamp = (store: CanvasStore): void => {
    const Probe = (): null => {
      useStampNewEdges(store, BOARD_ID, null)
      return null
    }
    act(() => {
      root.render(<Probe />)
    })
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
})
