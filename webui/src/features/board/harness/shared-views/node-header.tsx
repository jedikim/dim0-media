import { Icon } from "@iconify/react"
import { Lock } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"


export type NodeHeaderProps = {
  /** Title text shown in the bar. */
  title: string | undefined
  /** Iconify icon name (e.g. "lucide:folder"). Rendered to the left of the title. */
  emojiIcon?: string
  /** When provided, double-clicking the title opens an inline text editor. */
  onTitleEdit?: (next: string) => void
  /** Show a lock chip on the right when true. Also disables inline edit. */
  locked?: boolean
  /** Placeholder when title is empty. */
  placeholder?: string
  className?: string
}


/**
 * Title bar for a custom node view. Emoji on the left, title in the
 * middle, lock indicator on the right. Inline title editing is opt-in
 * via `onTitleEdit` — double-click to edit, Enter commits, Esc cancels.
 */
export function NodeHeader({
  title,
  emojiIcon,
  onTitleEdit,
  locked,
  placeholder = "Untitled",
  className,
}: NodeHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const beginEdit = () => {
    if (!onTitleEdit || locked) return
    setDraft(title ?? "")
    setEditing(true)
  }

  const commit = () => {
    if (onTitleEdit && draft !== title) onTitleEdit(draft)
    setEditing(false)
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1 text-sm text-foreground",
        className,
      )}
    >
      {emojiIcon ? (
        <Icon icon={emojiIcon} className="size-4 shrink-0 text-muted-foreground" />
      ) : null}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            else if (e.key === "Escape") setEditing(false)
          }}
          className="flex-1 bg-transparent outline-none"
        />
      ) : (
        <span
          className={cn("flex-1 truncate", !title && "italic text-muted-foreground")}
          onDoubleClick={beginEdit}
        >
          {title || placeholder}
        </span>
      )}

      {locked ? (
        <Lock className="size-3.5 shrink-0 text-muted-foreground" weight="fill" />
      ) : null}
    </div>
  )
}
