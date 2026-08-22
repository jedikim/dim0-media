import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createCanvasStore } from "@canvas-harness/core"
import type { CanvasCreateDragEvent } from "@canvas-harness/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useAppStore } from "@/store"
import { useBoardAppStore } from "../store/board-app-store"
import { useCreateHandlers } from "./use-create-handlers"
import type { StyleMemoryApi } from "./use-style-memory"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true


describe("useCreateHandlers image generator", () => {
  let container: HTMLDivElement
  let root: Root


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    useAppStore.setState({ billingActive: false, userPlan: "free" })
    useBoardAppStore.setState({ currentFolderDepth: 0 })
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })


  it("creates a rectangle-backed first-party node at a usable minimum size", () => {
    const store = createCanvasStore()
    const styleMemory: StyleMemoryApi = {
      getNodeStyle: () => undefined,
      getEdgeStyle: () => undefined,
      getEdgePathStyle: () => undefined,
      getEdgeStoredColors: () => undefined,
    }
    let handler: ((event: CanvasCreateDragEvent) => void) | null = null
    const Probe = (): null => {
      handler = useCreateHandlers(store, "board-1", null, styleMemory).handleCreateDrag
      return null
    }
    act(() => root.render(<Probe />))

    act(() => handler?.({
      tool: "image-generator",
      rect: { x: 10, y: 20, w: 100, h: 100 },
    } as CanvasCreateDragEvent))

    const node = store.getAllNodes()[0]
    expect(node?.type).toBe("image-generator")
    expect(node?.w).toBe(520)
    expect(node?.h).toBe(560)
    expect(node?.data).toMatchObject({
      graphUid: "board-1",
      styleType: "rectangle",
      minWidth: 520,
      minHeight: 560,
      properties: {
        imagePrompt: { type: "text", text: "" },
      },
    })
  })
})
