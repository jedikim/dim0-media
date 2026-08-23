import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { asNodeId, createCanvasStore, type CanvasStore } from "@canvas-harness/core"
import { CanvasProvider } from "@canvas-harness/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useBoardAppStore } from "../store/board-app-store"
import { NodeTitleCaption } from "./node-title-caption"


describe("NodeTitleCaption", () => {
  let container: HTMLDivElement
  let root: Root
  let store: CanvasStore
  let queryClient: QueryClient


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    store = createCanvasStore()
    queryClient = new QueryClient()
    useBoardAppStore.setState({ canEdit: true })
    store.addNode({
      id: asNodeId("generator-1"),
      type: "image-generator",
      x: 0,
      y: 0,
      w: 520,
      h: 560,
      angle: 0,
      z: 0,
      groups: [],
      data: { graphUid: "board-1", properties: {} },
    })
  })


  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
  })


  it("shows the generator placeholder and commits an edited data.label", () => {
    act(() => root.render(
      <QueryClientProvider client={queryClient}>
        <CanvasProvider store={store}>
          <NodeTitleCaption
            nodeId={asNodeId("generator-1")}
            placeholder="Image Generator"
            maxLines={1}
          />
        </CanvasProvider>
      </QueryClientProvider>,
    ))

    const title = container.querySelector<HTMLButtonElement>("button")!
    expect(title.textContent).toBe("Image Generator")
    act(() => title.click())

    const input = container.querySelector<HTMLInputElement>("input")!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    act(() => {
      setter?.call(input, "Concept art")
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(store.getNode(asNodeId("generator-1"))?.data).toEqual(expect.objectContaining({
      label: { markdown: "Concept art" },
    }))
  })
})
