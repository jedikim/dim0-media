import { useEffect, useRef, useState } from "react"
import { type NodeId } from "@canvas-harness/core"
import { useCanvasStore, useNode } from "@canvas-harness/react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { ensureLanguage, highlightCodeSync } from "@/lib/shiki"
import { DEFAULT_CODE_LANGUAGE } from "@/features/board/api/execute-code-note"
import type { NoteNodeData } from "../../convert/note-to-node"
import {
  NodeTitleCaption,
  NodeTrafficLights,
  useStopCanvasGesture,
} from "../../shared-views"
import { useBoardAppStore } from "../../store/board-app-store"


export type CodeSandboxViewProps = {
  id: NodeId
}


const PLACEHOLDER = "// Write code here"


/**
 * Code node inline preview. The full body is the click target; syntax
 * highlighting uses the note's `programmingLanguage` and tracks the active
 * theme pair from `useTheme()` so the preview swaps palette together with
 * the rest of the app. Falls back to plain text on the first paint while
 * Shiki finishes loading the grammar + theme JSON.
 */
export function CodeSandboxView({ id }: CodeSandboxViewProps) {
  const node = useNode(id)
  const store = useCanvasStore()
  const openNodeSurface = useBoardAppStore((s) => s.openNodeSurface)
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const bodyRef = useRef<HTMLButtonElement>(null)
  useStopCanvasGesture(bodyRef)
  const { shikiThemes } = useTheme()

  const data = (node?.data ?? {}) as Partial<NoteNodeData>
  const language = data.properties?.programmingLanguage?.text || DEFAULT_CODE_LANGUAGE

  const code = node?.content ?? ""
  const display = code || PLACEHOLDER
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  useEffect(() => {
    const html = highlightCodeSync(display, language, shikiThemes)
    if (html != null) {
      setPreviewHtml(html)
      return
    }
    setPreviewHtml(null)
    let cancelled = false
    ensureLanguage(language, shikiThemes, () => {
      if (cancelled) return
      setPreviewHtml(highlightCodeSync(display, language, shikiThemes))
    })
    return () => { cancelled = true }
  }, [display, language, shikiThemes])

  if (!node) return null

  const label = data.label?.markdown

  return (
    <div className="pointer-events-none relative h-full w-full select-none">
      <button
        ref={bodyRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!canEdit) return
          openNodeSurface(id as unknown as string, "code-sandbox")
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn(
          "absolute inset-0 overflow-hidden rounded-2xl text-left shadow-sm bg-card text-foreground",
          "pointer-events-auto",
          canEdit ? "cursor-pointer" : "cursor-default",
        )}
        title={canEdit ? "Open code" : "Code preview"}
      >
        {previewHtml != null ? (
          <div
            className={cn(
              "relative h-full w-full overflow-auto scrollbar-thin px-3 pb-3 pt-10",
              // Shiki paints its own <pre> bg; flatten chrome so the inline
              // preview reads as one continuous code surface.
              "[&>pre]:m-0 [&>pre]:p-0 [&>pre]:font-mono [&>pre]:text-base [&>pre]:leading-5",
              "[&>pre]:whitespace-pre-wrap [&>pre]:break-words [&>pre]:min-h-full",
            )}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <pre className="relative h-full w-full overflow-auto scrollbar-thin px-3 pb-3 pt-10 m-0 font-mono text-base leading-5 whitespace-pre-wrap break-words">
            {display}
          </pre>
        )}
      </button>

      <NodeTrafficLights
        onDelete={canEdit ? () => store.removeNode(id) : undefined}
        onExpand={canEdit ? () => openNodeSurface(id as unknown as string, "code-sandbox") : undefined}
      />

      <div className="pointer-events-auto absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2">
        <NodeTitleCaption
          nodeId={id}
          label={label}
          placeholder="Untitled code"
          textClassName="text-center text-sm font-handwriting text-foreground"
        />
      </div>
    </div>
  )
}
