import { type NodeId } from "@canvas-harness/core"
import { useCanvasStore, useNode } from "@canvas-harness/react"
import { cn } from "@/lib/utils"
import type { NoteNodeData } from "../../convert/note-to-node"
import {
  NodeTitleCaption,
  NodeTrafficLights,
  useIsEmbeddedNodeView,
} from "../../shared-views"
import { useBoardAppStore } from "../../store/board-app-store"


export type FolderViewProps = {
  id: NodeId
}


/**
 * Inline SVG silhouette that mirrors `drawFolderPlaceholder` — tab on
 * top-left, rounded body below. Dimensions scale with the parent box;
 * `preserveAspectRatio="none"` lets us reuse the same path for any
 * node aspect ratio without recomputing geometry.
 *
 * Using `currentColor` for stroke + `bg-card` for fill lets the
 * silhouette adopt the active theme automatically.
 */
const FolderSilhouette = () => (
  <svg
    viewBox="0 0 200 140"
    width="100%"
    height="100%"
    preserveAspectRatio="none"
    className="text-muted-foreground/60"
    aria-hidden="true"
  >
    {/* Tab — soft trapezoid on the top-left. */}
    <path
      d="M 7 0 L 65 0 L 75 25 L 0 25 L 0 7 Q 0 0 7 0 Z"
      fill="var(--card)"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    {/* Body — rounded rect below the tab. */}
    <path
      d="M 7 25 L 193 25 Q 200 25 200 32 L 200 133 Q 200 140 193 140 L 7 140 Q 0 140 0 133 L 0 25 Z"
      fill="var(--card)"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)


/**
 * Folder React view — replaces the canvas placeholder at zoom ≥ 0.4.
 * Renders the same tab+body silhouette via inline SVG so low- and
 * high-zoom look identical (the canvas placeholder we ship matches
 * this exact shape). Editable title sits below the card.
 */
export function FolderView({ id }: FolderViewProps) {
  const node = useNode(id)
  const store = useCanvasStore()
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const embedded = useIsEmbeddedNodeView()
  if (!node) return null

  const data = (node.data ?? {}) as Partial<NoteNodeData>
  const label = data.label?.markdown

  return (
    <div
      className="pointer-events-none relative h-full w-full select-none"
      data-folder-label-edit-guard="true"
    >
      <div className="absolute inset-0">
        <FolderSilhouette />
      </div>

      {embedded ? (
        <NodeTrafficLights
          onDelete={canEdit ? () => store.removeNode(id) : undefined}
        />
      ) : null}

      <div
        data-folder-label-edit="true"
        className={cn(
          "absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2",
          "pointer-events-auto",
        )}
      >
        <NodeTitleCaption
          nodeId={id}
          label={label}
          placeholder="Untitled folder"
          textClassName="text-center text-sm font-handwriting text-foreground"
        />
      </div>
    </div>
  )
}
