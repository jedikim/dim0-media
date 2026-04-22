import { createElement, createRef } from "react"
import { createRoot } from "react-dom/client"
import type { SuggestionOptions } from "@tiptap/suggestion"
import { SlashMenu, type SlashMenuHandle } from "./slash-menu"
import { filterCommands, type SlashCommand } from "./commands"
import type { Editor, Range } from "@tiptap/core"

export const slashSuggestion: Omit<SuggestionOptions, "editor"> = {
  char: "/",
  allowSpaces: false,

  items({ query }) {
    return filterCommands(query)
  },

  render() {
    // menuRef lives inside render() — one per editor instance
    const menuRef = createRef<SlashMenuHandle>()
    let container: HTMLDivElement | null = null
    let root: ReturnType<typeof createRoot> | null = null
    let host: HTMLElement | null = null
    let escCapture: ((e: KeyboardEvent) => void) | null = null

    function positionContainer(rect: DOMRect): void {
      if (!container) return
      // When host is a transformed ancestor (Radix DialogContent uses
      // translate(-50%, -50%)), `position: fixed` is "contained" by that
      // ancestor. Subtract the host's rect so the menu still lands at the
      // right viewport spot.
      const hostRect = host?.getBoundingClientRect()
      const top = hostRect ? rect.bottom + 6 - hostRect.top : rect.bottom + 6
      const left = hostRect ? rect.left - hostRect.left : rect.left
      container.style.top = `${top}px`
      container.style.left = `${left}px`
    }

    return {
      onStart(props) {
        const rect = props.clientRect?.()
        if (!rect) return

        // Mount inside the Radix DialogContent (if present) so the dialog's
        // scroll-lock and focus-trap treat the menu as "inside the modal".
        // Fall back to document.body otherwise.
        const editorDom = props.editor.view.dom as HTMLElement
        host =
          editorDom.closest<HTMLElement>('[data-slot="dialog-content"]') ??
          editorDom.closest<HTMLElement>('[role="dialog"]') ??
          document.body

        container = document.createElement("div")
        // pointer-events: auto overrides Radix Dialog's body-level
        // `pointer-events: none` scroll-lock cascade.
        container.style.cssText = `
          position: fixed;
          z-index: 9999;
          pointer-events: auto;
        `
        host.appendChild(container)
        positionContainer(rect)

        // Radix DismissableLayer registers an Escape listener on `document`
        // in capture phase; on same-element same-phase, registration order
        // wins, and the Dialog was mounted first. Attach to `window` capture
        // instead — it fires before `document` capture in the DOM flow, so
        // stopImmediatePropagation reliably blocks Radix from seeing Escape.
        escCapture = (e: KeyboardEvent) => {
          if (e.key !== "Escape") return
          e.preventDefault()
          e.stopImmediatePropagation()
          root?.unmount()
          container?.remove()
          if (escCapture) window.removeEventListener("keydown", escCapture, true)
          root = null
          container = null
          host = null
          escCapture = null
        }
        window.addEventListener("keydown", escCapture, true)
        root = createRoot(container)
        root.render(
          createElement(SlashMenu, {
            ref: menuRef,
            items: props.items as SlashCommand[],
            command: (item) => props.command(item),
          })
        )
      },

      onUpdate(props) {
        const rect = props.clientRect?.()
        if (!container || !root) return
        if (rect) positionContainer(rect)
        root.render(
          createElement(SlashMenu, {
            ref: menuRef,
            items: props.items as SlashCommand[],
            command: (item) => props.command(item),
          })
        )
      },

      onKeyDown({ event }) {
        // Escape is handled by the capture-phase listener installed in onStart.
        return menuRef.current?.onKeyDown(event) ?? false
      },

      onExit() {
        root?.unmount()
        container?.remove()
        if (escCapture) window.removeEventListener("keydown", escCapture, true)
        root = null
        container = null
        host = null
        escCapture = null
      },
    }
  },

  // props here is the SlashCommand item passed via props.command(item) in render
  command({ editor, range, props }) {
    const item = props as SlashCommand
    item.action(editor as Editor, range as Range)
  },
}
