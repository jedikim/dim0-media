import { CaretRight } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"


export type BreadcrumbItem = {
  id: string
  label: string
}


export type NodeBreadcrumbProps = {
  /** Ancestry from root to current. Last item is the current node and renders non-interactive. */
  path: ReadonlyArray<BreadcrumbItem>
  /** Click handler for non-leaf segments. Omit to render entire path as plain text. */
  onNavigate?: (id: string) => void
  className?: string
}


/**
 * Folder-path breadcrumb for a custom node view. Rendered above the
 * NodeHeader on nested surfaces (sheets, code-sandboxes, widgets) when
 * the user is multiple folders deep.
 */
export function NodeBreadcrumb({ path, onNavigate, className }: NodeBreadcrumbProps) {
  if (path.length === 0) return null

  return (
    <nav
      className={cn(
        "flex items-center gap-1 px-2 text-xs text-muted-foreground",
        className,
      )}
      aria-label="Node path"
    >
      {path.map((item, i) => {
        const isLast = i === path.length - 1
        const interactive = onNavigate && !isLast
        return (
          <div key={item.id} className="flex items-center gap-1">
            {interactive ? (
              <button
                type="button"
                onClick={() => onNavigate(item.id)}
                className="truncate hover:text-foreground hover:underline"
              >
                {item.label}
              </button>
            ) : (
              <span className={cn("truncate", isLast && "text-foreground")}>
                {item.label}
              </span>
            )}
            {!isLast ? <CaretRight className="size-3 shrink-0" /> : null}
          </div>
        )
      })}
    </nav>
  )
}
