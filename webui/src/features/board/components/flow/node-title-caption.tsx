import { memo, useCallback, useEffect, useRef, useState } from "react"
import clsx from "clsx"

import { useGraphStore } from "../../store/graph-store"


type NodeTitleCaptionProps = {
  nodeId: string
  label?: string
  placeholder?: string
  className?: string
  textClassName?: string
  emptyTextClassName?: string
  textStyle?: React.CSSProperties
  maxLines?: number
  onEditingChange?: (editing: boolean) => void
}


const INPUT_BASE_CLS = "nodrag w-full bg-transparent border-0 border-b border-foreground/30 focus:border-secondary-foreground focus:outline-none px-0 py-0.5"
const BUTTON_BASE_CLS = "nodrag block w-full whitespace-normal break-words hover:underline"


/**
 * Shared click-to-edit title/caption for canvas nodes. Reads/writes
 * `note.label.markdown`. Layout and text styling are owned by the caller via
 * `className` and `textClassName`. Display mode wraps to `maxLines` lines
 * (clamps with ellipsis); edit mode is always a single-line input.
 */
export const NodeTitleCaption = memo(function NodeTitleCaption({
  nodeId,
  label,
  placeholder = "Untitled",
  className,
  textClassName,
  emptyTextClassName,
  textStyle,
  maxLines = 3,
  onEditingChange,
}: NodeTitleCaptionProps) {
  const boardCanEdit = useGraphStore((state) => state.boardCanEdit)
  const updateNodeByIdPersist = useGraphStore((state) => state.updateNodeByIdPersist)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label || "")
  const inputRef = useRef<HTMLInputElement | null>(null)

  const storedTitle = label?.trim() || ""
  const displayTitle = storedTitle || placeholder

  useEffect(() => {
    if (editing) return
    setDraft(label || "")
  }, [label, editing])

  useEffect(() => {
    if (!editing) return
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [editing])

  useEffect(() => {
    onEditingChange?.(editing)
  }, [editing, onEditingChange])

  const commitTitle = useCallback((nextRaw: string) => {
    const next = nextRaw.trim()
    const prev = label?.trim() || ""
    if (next === prev) return

    updateNodeByIdPersist(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        label: next ? { markdown: next } : undefined,
      },
    }))
  }, [nodeId, label, updateNodeByIdPersist])

  const stopEdit = useCallback((save: boolean) => {
    if (save) commitTitle(draft)
    else setDraft(label || "")
    setEditing(false)
  }, [commitTitle, draft, label])

  const displayClamp: React.CSSProperties | undefined = maxLines && maxLines > 1
    ? {
      display: "-webkit-box",
      WebkitLineClamp: maxLines,
      WebkitBoxOrient: "vertical",
      overflow: "hidden",
    }
    : undefined

  return (
    <div className={className}>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => stopEdit(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              stopEdit(true)
            }
            if (event.key === "Escape") {
              event.preventDefault()
              stopEdit(false)
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          className={clsx(INPUT_BASE_CLS, textClassName)}
          style={textStyle}
          placeholder={placeholder}
        />
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            if (!boardCanEdit) return
            setEditing(true)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className={clsx(
            BUTTON_BASE_CLS,
            maxLines === 1 && "truncate",
            storedTitle ? textClassName : (emptyTextClassName ?? textClassName),
          )}
          style={{ ...textStyle, ...displayClamp }}
          title={displayTitle}
        >
          {displayTitle}
        </button>
      )}
    </div>
  )
})
