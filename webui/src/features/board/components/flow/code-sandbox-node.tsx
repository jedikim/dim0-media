import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useTheme } from "@/components/theme-provider"

import { useGraphStore } from "../../store/graph-store"
import type { Note } from "../../types/note"
import {
  highlightPython,
  ROSE_PINE_DARK,
  ROSE_PINE_LIGHT,
} from "./code-sandbox-utils"
import "./code-sandbox-node.css"


type CodeSandboxNodeProps = {
  note: Note
  dragging?: boolean
}


/**
 * Read-only board preview for Python sandbox notes.
 */
export const CodeSandboxNode = memo(function CodeSandboxNode({
  note,
  dragging,
}: CodeSandboxNodeProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const palette = isDark ? ROSE_PINE_DARK : ROSE_PINE_LIGHT
  const isMoving = useGraphStore((state) => state.isMoving)
  const boardCanEdit = useGraphStore((state) => state.boardCanEdit)
  const openNodeSurface = useGraphStore((state) => state.openNodeSurface)
  const updateNodeByIdPersist = useGraphStore((state) => state.updateNodeByIdPersist)

  const codePreview = note.content?.markdown || "# Write Python here"
  const displayTitle = note.label?.markdown?.trim() || "Untitled sandbox"
  const previewHtml = useMemo(() => highlightPython(codePreview), [codePreview])
  const suspendPreview = Boolean(isMoving || dragging)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(note.label?.markdown || "")
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (titleEditing) return
    setTitleDraft(note.label?.markdown || "")
  }, [note.label?.markdown, titleEditing])

  useEffect(() => {
    if (!titleEditing) return
    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [titleEditing])

  /**
   * Persist the edited board title for this sandbox node.
   */
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

  /**
   * End inline title editing, optionally saving the latest draft.
   */
  const stopTitleEdit = useCallback((save: boolean) => {
    if (save) commitTitle(titleDraft)
    else setTitleDraft(note.label?.markdown || "")
    setTitleEditing(false)
  }, [commitTitle, note.label?.markdown, titleDraft])

  return (
    <div
      className="relative w-full h-full text-left rounded-2xl overflow-hidden shadow-sm"
      title={boardCanEdit ? "Open Python sandbox" : "Python sandbox preview"}
    >
      <div className="absolute left-3 top-3 right-3 z-20">
        {titleEditing ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => stopTitleEdit(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                stopTitleEdit(true)
              }
              if (event.key === "Escape") {
                event.preventDefault()
                stopTitleEdit(false)
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="nodrag w-full rounded-md border border-border/50 bg-black/20 px-2 py-1 text-sm font-medium text-white/95 shadow-sm backdrop-blur-sm focus:border-secondary-foreground focus:outline-none"
            placeholder="Untitled sandbox"
          />
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (!boardCanEdit) return
              setTitleEditing(true)
            }}
            className="nodrag block max-w-full truncate rounded-md bg-black/25 px-2 py-1 text-left text-sm font-medium text-white/95 shadow-sm backdrop-blur-sm hover:underline"
            title={displayTitle}
          >
            {displayTitle}
          </button>
        )}
      </div>

      <button
        type="button"
        className="block h-full w-full text-left"
        onClick={() => {
          if (!boardCanEdit) return
          openNodeSurface(note.id, "code-sandbox")
        }}
      >
        <div
          className={`code-sandbox-theme relative h-full w-full overflow-auto scrollbar-thin p-3 ${isDark ? "code-sandbox-theme-dark" : "code-sandbox-theme-light"}`}
          style={{
            backgroundColor: palette.bg,
            color: palette.text,
          }}
        >
          <div className="h-9" />
          {!suspendPreview && (
            <pre
              className="hljs min-h-full whitespace-pre-wrap break-words text-base leading-5 font-mono bg-transparent p-0"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
          {suspendPreview && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ backgroundColor: isDark ? "rgba(31,29,46,0.62)" : "rgba(255,250,243,0.72)" }}
            >
              <div
                className="rounded-full px-3 py-1 text-base font-medium"
                style={{
                  color: palette.muted,
                  backgroundColor: isDark ? "rgba(64,61,82,0.72)" : "rgba(223,218,217,0.8)",
                }}
              >
                Moving sandbox...
              </div>
            </div>
          )}
        </div>
      </button>
    </div>
  )
})
