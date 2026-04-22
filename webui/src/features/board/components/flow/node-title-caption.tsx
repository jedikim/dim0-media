import { useCallback, useEffect, useRef, useState } from "react"
import clsx from "clsx"

import { useGraphStore } from "../../store/graph-store"
import type { Note } from "../../types/note"


type NodeTitleCaptionProps = {
  note: Note
  placeholder?: string
  className?: string
  inputClassName?: string
  buttonClassName?: string
  onEditingChange?: (editing: boolean) => void
}


/**
 * Click-to-edit title/caption rendered beneath a node. Reads and writes
 * `note.label.markdown`, matching the title pattern used by widget/sheet nodes.
 * Visibility is controlled by the caller via the wrapping element's className.
 */
export function NodeTitleCaption({
  note,
  placeholder = "Untitled",
  className,
  inputClassName,
  buttonClassName,
  onEditingChange,
}: NodeTitleCaptionProps) {
  const boardCanEdit = useGraphStore((state) => state.boardCanEdit)
  const updateNodeByIdPersist = useGraphStore((state) => state.updateNodeByIdPersist)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.label?.markdown || "")
  const inputRef = useRef<HTMLInputElement | null>(null)

  const storedTitle = note.label?.markdown?.trim() || ""
  const displayTitle = storedTitle || placeholder

  useEffect(() => {
    if (editing) return
    setDraft(note.label?.markdown || "")
  }, [note.label?.markdown, editing])

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
    const prev = note.label?.markdown?.trim() || ""
    if (next === prev) return

    updateNodeByIdPersist(note.id, (node) => ({
      ...node,
      data: {
        ...node.data,
        label: next ? { markdown: next } : undefined,
      },
    }))
  }, [note.id, note.label?.markdown, updateNodeByIdPersist])

  const stopEdit = useCallback((save: boolean) => {
    if (save) commitTitle(draft)
    else setDraft(note.label?.markdown || "")
    setEditing(false)
  }, [commitTitle, draft, note.label?.markdown])

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
          className={clsx(
            "nodrag w-full bg-transparent border-0 border-b border-foreground/30 focus:border-secondary-foreground focus:outline-none px-0 py-0.5 text-center text-sm font-medium text-foreground",
            inputClassName,
          )}
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
          className={clsx(
            "nodrag block w-full truncate text-center text-sm font-medium hover:underline",
            storedTitle ? "text-foreground" : "text-muted-foreground italic",
            buttonClassName,
          )}
          title={displayTitle}
        >
          {displayTitle}
        </button>
      )}
    </div>
  )
}
