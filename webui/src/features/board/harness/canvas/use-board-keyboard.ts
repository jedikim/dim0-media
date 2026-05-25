import { useEffect } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import { useBoardAppStore } from "../store/board-app-store"


/**
 * Tells whether a keyboard event originated from a focused text-entry
 * surface. We don't steal undo/redo or tool shortcuts from those — the
 * user is typing.
 */
const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true
  if (target.isContentEditable) return true
  return false
}


/** Single-key shortcuts that map straight to a tool-mode swap. */
const TOOL_SHORTCUTS: Record<string, string> = {
  p: "pan",
  h: "pan",
  v: "select",
  a: "arrow",
  t: "text",
  n: "sheet",
  r: "rect",
  o: "ellipse",
  d: "diamond",
  y: "code-sandbox",
}


/**
 * Global keyboard bindings for the canvas-harness board. Mirrors
 * prod's `use-board-shortcuts` keymap so muscle memory carries over:
 *
 *  - Cmd/Ctrl+Z / Shift+Z / Cmd+Y → undo / redo
 *  - P / H                        → pan tool
 *  - V                            → select tool
 *  - A                            → connector (arrow)
 *  - T                            → text tool
 *  - N                            → sheet tool
 *  - R / O / D                    → rect / ellipse / diamond tool
 *  - Y                            → code-sandbox tool
 *  - S                            → open Shapes menu
 *  - M                            → toggle Slides panel
 *  - G                            → open Icons search dialog
 *  - I                            → open Images search dialog
 *
 * Skipped when focus is in an input / textarea / contentEditable so
 * inline editing keeps the native shortcuts. canvas-harness already
 * wires Cmd+C/X/V/[]/]} internally — see Canvas.tsx.
 */
export const useBoardKeyboard = (store: CanvasStore): void => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return
      const meta = e.metaKey || e.ctrlKey

      if (meta && (e.key === "z" || e.key === "Z")) {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (meta && (e.key === "y" || e.key === "Y")) {
        e.preventDefault()
        store.redo()
        return
      }

      if (meta || e.altKey || e.shiftKey) return

      const key = e.key.toLowerCase()
      const app = useBoardAppStore.getState()

      const tool = TOOL_SHORTCUTS[key]
      if (tool) {
        e.preventDefault()
        app.setTool(tool)
        return
      }

      if (key === "s") {
        e.preventDefault()
        app.setChromeDialog(app.chromeDialog === "shape-menu" ? null : "shape-menu")
        return
      }
      if (key === "g") {
        e.preventDefault()
        app.setChromeDialog("icon-search")
        return
      }
      if (key === "i") {
        e.preventDefault()
        app.setChromeDialog("image-search")
        return
      }
      if (key === "m") {
        e.preventDefault()
        app.setSlidesPanelOpen(!app.slidesPanelOpen)
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [store])
}
