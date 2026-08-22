import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createCanvasStore } from "@canvas-harness/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useBoardAppStore } from "../store/board-app-store"
import { useBoardKeyboard } from "./use-board-keyboard"


describe("useBoardKeyboard image import permission", () => {
  let container: HTMLDivElement
  let root: Root


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    useBoardAppStore.setState({ canEdit: true, chromeDialog: null })
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useBoardAppStore.setState({ canEdit: true, chromeDialog: null })
  })


  const mount = (): void => {
    const store = createCanvasStore()
    const Probe = (): null => {
      useBoardKeyboard(store)
      return null
    }
    act(() => root.render(<Probe />))
  }


  it("does not open the image dialog for a viewer shortcut", () => {
    useBoardAppStore.setState({ canEdit: false })
    mount()

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "i" })))

    expect(useBoardAppStore.getState().chromeDialog).toBeNull()
  })


  it("keeps the editor image shortcut available", () => {
    mount()

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "i" })))

    expect(useBoardAppStore.getState().chromeDialog).toBe("image-search")
  })
})
