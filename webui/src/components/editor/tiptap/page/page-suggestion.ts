import { createElement, createRef } from "react"
import { createRoot } from "react-dom/client"
import type { SuggestionOptions } from "@tiptap/suggestion"
import type { Editor, Range } from "@tiptap/core"
import { PageSearchMenu, type PageSearchMenuHandle, type PageSearchSelection } from "./page-search-menu"
import type { Page, PageProvider } from "./types"
import { primePageCache } from "./page-cache"


function getProvider(editor: Editor): PageProvider | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = (editor.storage as any).pageProvider
  return storage?.provider ?? null
}


/**
 * `@`-mention suggestion config: queries the host's PageProvider, lists
 * matching pages, plus a "create new page" entry. Renders the menu in a
 * portal aware of the surrounding Radix Dialog (same pattern as the
 * slash command).
 */
export const pageSuggestion: Omit<SuggestionOptions<Page, PageSearchSelection>, "editor"> = {
  char: "@",
  allowSpaces: true,

  async items({ query, editor }) {
    const provider = getProvider(editor)
    if (!provider) return []
    try {
      return await provider.list(query)
    } catch (err) {
      console.error("[pageSuggestion] list failed", err)
      return []
    }
  },

  // Top-level command receives the picked selection from the menu.
  command({ editor, range, props }: {
    editor: Editor
    range: Range
    props: PageSearchSelection
  }) {
    const provider = getProvider(editor)

    async function insertRef(page: Page) {
      // Pre-fill the cache so the chip shows the live title immediately,
      // not just the snapshot we wrote into the markdown.
      primePageCache(page)
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: "pageRef",
            attrs: { pageId: page.id, title: page.title || "Untitled" },
          },
          { type: "text", text: " " },
        ])
        .run()
    }

    if (props.kind === "existing") {
      void insertRef(props.page)
      return
    }

    // kind === "create"
    if (!provider) return
    void (async () => {
      try {
        const page = await provider.create({ title: props.title })
        await insertRef({
          id: page.id,
          title: page.title || props.title || "Untitled",
        })
      } catch (err) {
        console.error("[pageSuggestion] create failed", err)
      }
    })()
  },

  render() {
    const menuRef = createRef<PageSearchMenuHandle>()
    let container: HTMLDivElement | null = null
    let root: ReturnType<typeof createRoot> | null = null
    let host: HTMLElement | null = null
    let escCapture: ((e: KeyboardEvent) => void) | null = null

    function positionContainer(rect: DOMRect): void {
      if (!container) return
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

        const editorDom = props.editor.view.dom as HTMLElement
        host =
          editorDom.closest<HTMLElement>('[data-slot="dialog-content"]') ??
          editorDom.closest<HTMLElement>('[role="dialog"]') ??
          document.body

        container = document.createElement("div")
        container.style.cssText = `
          position: fixed;
          z-index: 9999;
          pointer-events: auto;
        `
        host.appendChild(container)
        positionContainer(rect)

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
          createElement(PageSearchMenu, {
            ref: menuRef,
            items: (props.items as Page[]) ?? [],
            query: props.query,
            onSelect: (selection) => props.command(selection),
          }),
        )
      },

      onUpdate(props) {
        const rect = props.clientRect?.()
        if (!container || !root) return
        if (rect) positionContainer(rect)
        root.render(
          createElement(PageSearchMenu, {
            ref: menuRef,
            items: (props.items as Page[]) ?? [],
            query: props.query,
            onSelect: (selection) => props.command(selection),
          }),
        )
      },

      onKeyDown({ event }) {
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
}
