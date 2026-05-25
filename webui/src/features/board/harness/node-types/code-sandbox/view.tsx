import { useMemo, useRef } from "react"
import type { NodeId } from "@canvas-harness/core"
import { useNode } from "@canvas-harness/react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import {
  highlightPython,
  ROSE_PINE_DARK,
  ROSE_PINE_LIGHT,
} from "@/features/board/components/flow/code-sandbox-utils"
import "@/features/board/components/flow/code-sandbox-node.css"
import type { NoteNodeData } from "../../convert/note-to-node"
import {
  NodeDragHandle,
  NodeTitleCaption,
  useStopCanvasGesture,
} from "../../shared-views"
import { useBoardAppStore } from "../../store/board-app-store"


export type CodeSandboxViewProps = {
  id: NodeId
}


/**
 * Code-sandbox inline view — rose-pine themed Python preview. Entire
 * body is the click target (matches prod). Pan/zoom suspension is
 * handled by the canvas placeholder; this component only mounts at
 * idle so the rose-pine background never flashes during motion.
 */
export function CodeSandboxView({ id }: CodeSandboxViewProps) {
  const node = useNode(id)
  const openNodeSurface = useBoardAppStore((s) => s.openNodeSurface)
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const bodyRef = useRef<HTMLButtonElement>(null)
  useStopCanvasGesture(bodyRef)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const palette = isDark ? ROSE_PINE_DARK : ROSE_PINE_LIGHT

  const code = node?.content ?? ""
  const previewHtml = useMemo(
    () => highlightPython(code || "# Write Python here"),
    [code],
  )

  if (!node) return null

  const data = (node.data ?? {}) as Partial<NoteNodeData>
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
          "absolute inset-0 overflow-hidden rounded-2xl text-left shadow-sm",
          "pointer-events-auto",
          canEdit ? "cursor-pointer" : "cursor-default",
        )}
        title={canEdit ? "Open Python sandbox" : "Python sandbox preview"}
      >
        <div
          className={cn(
            "code-sandbox-theme relative h-full w-full overflow-auto scrollbar-thin p-3",
            isDark ? "code-sandbox-theme-dark" : "code-sandbox-theme-light",
          )}
          style={{ backgroundColor: palette.bg, color: palette.text }}
        >
          <pre
            className="hljs min-h-full whitespace-pre-wrap break-words bg-transparent p-0 font-mono text-base leading-5"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </button>

      <NodeDragHandle />

      <div className="pointer-events-auto absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2">
        <NodeTitleCaption
          nodeId={id}
          label={label}
          placeholder="Untitled sandbox"
          textClassName="text-center text-sm font-handwriting text-foreground"
        />
      </div>
    </div>
  )
}
