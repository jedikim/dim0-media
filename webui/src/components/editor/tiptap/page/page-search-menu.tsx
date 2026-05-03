import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { FileText, Plus } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import type { Page } from "./types"


export type PageSearchSelection =
  | { kind: "existing"; page: Page }
  | { kind: "create"; title: string }


interface Props {
  items: Page[]
  query: string
  onSelect: (selection: PageSearchSelection) => void
}


export interface PageSearchMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}


/**
 * Floating menu that lists matching pages plus a "create new page" option.
 * Mirrors the slash-menu's keyboard-nav contract so the suggestion plugin
 * can hand it Up/Down/Enter events.
 */
export const PageSearchMenu = forwardRef<PageSearchMenuHandle, Props>(
  ({ items, query, onSelect }, ref) => {
    const totalItems = items.length + (query.trim() ? 1 : 0)
    const [selectedIndex, setSelectedIndex] = useState(0)
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

    useEffect(() => setSelectedIndex(0), [items, query])

    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" })
    }, [selectedIndex])

    useImperativeHandle(ref, () => ({
      onKeyDown(event: KeyboardEvent) {
        if (totalItems === 0) return false
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i - 1 + totalItems) % totalItems)
          return true
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % totalItems)
          return true
        }
        if (event.key === "Enter") {
          if (selectedIndex < items.length) {
            onSelect({ kind: "existing", page: items[selectedIndex] })
          } else {
            onSelect({ kind: "create", title: query.trim() })
          }
          return true
        }
        return false
      },
    }))

    if (totalItems === 0) {
      return (
        <div className="page-search-menu" onMouseDown={(e) => e.preventDefault()}>
          <p className="page-search-empty">No pages — start typing to create one</p>
        </div>
      )
    }

    return (
      <div className="page-search-menu" onMouseDown={(e) => e.preventDefault()}>
        {items.length > 0 && (
          <p className="page-search-section">Pages</p>
        )}
        {items.map((page, index) => {
          const active = index === selectedIndex
          return (
            <button
              key={page.id}
              ref={(el) => { itemRefs.current[index] = el }}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect({ kind: "existing", page })
              }}
              className={cn(
                "page-search-item",
                active && "page-search-item--active",
              )}
            >
              <FileText size={14} className="page-search-item-icon" />
              <span className="truncate">{page.title || "Untitled"}</span>
            </button>
          )
        })}

        {query.trim() && (
          <>
            {items.length > 0 && <div className="page-search-divider" />}
            <p className="page-search-section">Create</p>
            <button
              ref={(el) => { itemRefs.current[items.length] = el }}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect({ kind: "create", title: query.trim() })
              }}
              className={cn(
                "page-search-item",
                selectedIndex === items.length && "page-search-item--active",
              )}
            >
              <Plus size={14} className="page-search-item-icon" />
              <span className="truncate">{`New page "${query.trim()}"`}</span>
            </button>
          </>
        )}
      </div>
    )
  },
)


PageSearchMenu.displayName = "PageSearchMenu"
