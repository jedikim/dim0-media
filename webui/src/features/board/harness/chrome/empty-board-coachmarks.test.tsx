// Tests for the empty-board coachmark overlay.
//
// The harness has no @testing-library/react dependency; we mount with
// vanilla `react-dom/client` against jsdom, wrapped in `act` so effects
// (anchor measurement) flush before assertions.
//
// `useNodes`/`useEdges` and the board-app-store are mocked via hoisted
// mutable state so each test can dial the gate inputs (empty? editable?
// presenting?) and the set of chrome anchors present in the DOM.

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const hooks = vi.hoisted(() => ({
  nodes: [] as unknown[],
  edges: [] as unknown[],
}))

const store = vi.hoisted(() => ({
  canEdit: true,
  presentationMode: false,
}))

vi.mock("@canvas-harness/react", () => ({
  useNodes: () => hooks.nodes,
  useEdges: () => hooks.edges,
}))

vi.mock("../store/board-app-store", () => ({
  useBoardAppStore: (selector: (s: typeof store) => unknown) => selector(store),
}))


import { EmptyBoardCoachmarks } from "./empty-board-coachmarks"


const ANCHOR_KEYS = ["title", "toolbar", "share", "ai-island"] as const


/** Drop a tagged stand-in for each named piece of chrome so the overlay
 *  can find anchors via `[data-coachmark="..."]`. */
function mountAnchors(keys: readonly string[]): HTMLElement[] {
  return keys.map((key) => {
    const el = document.createElement("div")
    el.setAttribute("data-coachmark", key)
    document.body.appendChild(el)
    return el
  })
}


describe("EmptyBoardCoachmarks", () => {
  let container: HTMLDivElement
  let root: Root
  let originalWidth: number


  beforeEach(() => {
    hooks.nodes = []
    hooks.edges = []
    store.canEdit = true
    store.presentationMode = false
    originalWidth = window.innerWidth
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })


  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    document.querySelectorAll("[data-coachmark]").forEach((el) => el.remove())
    window.innerWidth = originalWidth
  })


  function render(ready: boolean) {
    act(() => {
      root.render(<EmptyBoardCoachmarks ready={ready} />)
    })
  }


  it("shows the layer on a ready, empty, editable board", () => {
    mountAnchors(ANCHOR_KEYS)
    render(true)
    expect(container.querySelector(".coachmark-layer")).not.toBeNull()
  })


  it("stays hidden until hydration is ready", () => {
    mountAnchors(ANCHOR_KEYS)
    render(false)
    expect(container.querySelector(".coachmark-layer")).toBeNull()
  })


  it("stays hidden once the board has any node", () => {
    hooks.nodes = [{ id: "n1" }]
    mountAnchors(ANCHOR_KEYS)
    render(true)
    expect(container.querySelector(".coachmark-layer")).toBeNull()
  })


  it("stays hidden once the board has any edge", () => {
    hooks.edges = [{ id: "e1" }]
    mountAnchors(ANCHOR_KEYS)
    render(true)
    expect(container.querySelector(".coachmark-layer")).toBeNull()
  })


  it("stays hidden for a read-only viewer", () => {
    store.canEdit = false
    mountAnchors(ANCHOR_KEYS)
    render(true)
    expect(container.querySelector(".coachmark-layer")).toBeNull()
  })


  it("stays hidden in presentation mode", () => {
    store.presentationMode = true
    mountAnchors(ANCHOR_KEYS)
    render(true)
    expect(container.querySelector(".coachmark-layer")).toBeNull()
  })


  it("stays hidden on narrow (mobile) viewports", () => {
    window.innerWidth = 500
    mountAnchors(ANCHOR_KEYS)
    render(true)
    expect(container.querySelector(".coachmark-layer")).toBeNull()
  })


  it("draws one connector per chrome anchor present in the DOM", () => {
    mountAnchors(ANCHOR_KEYS)
    render(true)
    // Each Connector renders a single <g> (line + arrowhead); ambient
    // edges render bare <path>s, so <g> count == resolved callouts.
    const connectors = container.querySelectorAll(".coachmark-layer svg g")
    expect(connectors.length).toBe(ANCHOR_KEYS.length)
  })


  it("skips callouts whose anchor is absent (e.g. Share hidden for non-owners)", () => {
    mountAnchors(["title", "toolbar", "ai-island"])
    render(true)
    const connectors = container.querySelectorAll(".coachmark-layer svg g")
    expect(connectors.length).toBe(3)
  })
})
