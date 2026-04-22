import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { SlashCommand } from "./commands"

interface Props {
  items: SlashCommand[]
  command: (item: SlashCommand) => void
}

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export const SlashMenu = forwardRef<SlashMenuHandle, Props>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

    // reset selection when items change
    useEffect(() => setSelectedIndex(0), [items])

    // scroll selected item into view
    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" })
    }, [selectedIndex])

    useImperativeHandle(ref, () => ({
      onKeyDown(event: KeyboardEvent) {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i - 1 + items.length) % items.length)
          return true
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === "Enter") {
          const item = items[selectedIndex]
          if (item) command(item)
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="slash-menu" onMouseDown={(e) => e.preventDefault()}>
          <p className="px-3 py-2 font-sans text-xs text-muted-foreground">
            No results
          </p>
        </div>
      )
    }

    return (
      <div className="slash-menu" onMouseDown={(e) => e.preventDefault()}>
        <p className="px-3 pb-1 pt-2 font-sans text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Basic blocks
        </p>
        {items.map((item, index) => {
          const Icon = item.icon
          const active = index === selectedIndex
          return (
            <button
              key={item.title}
              ref={(el) => { itemRefs.current[index] = el }}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
                "font-sans text-sm text-foreground",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "hover:bg-muted",
              )}
            >
              <span className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border",
                "bg-card text-muted-foreground",
                active && "border-secondary-foreground/20 bg-secondary-foreground/10 text-secondary-foreground",
              )}>
                <Icon size={15} />
              </span>
              <span>{item.title}</span>
            </button>
          )
        })}
      </div>
    )
  },
)

SlashMenu.displayName = "SlashMenu"
