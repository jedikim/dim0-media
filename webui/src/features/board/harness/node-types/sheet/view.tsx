import { useCallback, useMemo, useRef, useState } from "react"
import { NotepadIcon } from "@phosphor-icons/react"
import { type NodeId } from "@canvas-harness/core"
import { useCanvasStore, useNode } from "@canvas-harness/react"
import { IconPropertyView } from "@/components/icons/icon-property-view"
import { createBoardPageProvider } from "@/features/board/providers/board-page-provider"
import { cn } from "@/lib/utils"
import type { NoteNodeData } from "../../convert/note-to-node"
import {
  NodeTitleCaption,
  NodeTrafficLights,
  useIsInView,
  useStopCanvasGesture,
} from "../../shared-views"
import { useBoardAppStore } from "../../store/board-app-store"
import { SheetInlineEditor } from "./sheet-inline-editor"


export type SheetViewProps = {
  id: NodeId
}


/**
 * Sheet inline view — sticky-note style card. The body renders through the
 * *same* TipTap pipeline as the modal editor ({@link SheetInlineEditor}) so
 * the preview is pixel-identical to edit mode (custom nodes, code, math). A
 * double-click flips the card into an editable editor in place; the expand
 * traffic-light still opens the full-screen modal. Editable title sits below.
 *
 * Content only mounts when the card intersects the viewport (`useIsInView`);
 * the lib's LOD-zoom + motion gating already suppresses the React view (and
 * thus any TipTap instance) entirely below the React threshold or while the
 * canvas is moving — so a wall of tiny sheets never mounts editors.
 */
export function SheetView({ id }: SheetViewProps) {
  const node = useNode(id)
  const store = useCanvasStore()
  const openNodeSurface = useBoardAppStore((s) => s.openNodeSurface)
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const [editing, setEditing] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  useStopCanvasGesture(bodyRef)
  // 200px margin so a pan barely off-screen doesn't blink the preview out.
  const isInView = useIsInView(wrapRef, "200px")

  const data = (node?.data ?? {}) as Partial<NoteNodeData>
  const boardId = data.graphUid

  // Backs @-mention / subpage chips in both the preview and edit mode.
  const pageProvider = useMemo(
    () =>
      boardId
        ? createBoardPageProvider({
            boardId,
            parentNoteId: id as unknown as string,
            onNavigate: (nid) => openNodeSurface(nid, "sheet"),
          })
        : null,
    [boardId, id, openNodeSurface],
  )

  const handleSave = useCallback(
    (markdown: string) => {
      store.updateNode(id, { content: markdown })
    },
    [store, id],
  )

  if (!node) return null

  const label = data.label?.markdown
  const body = node.content?.trim() ?? ""
  const iconValue = data.properties?.iconData?.icon ?? null

  const enterEdit = () => {
    if (canEdit) setEditing(true)
  }

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none relative h-full w-full select-none"
    >
      <div
        ref={bodyRef}
        role={!editing && canEdit ? "button" : undefined}
        tabIndex={!editing && canEdit ? 0 : undefined}
        onClick={(e) => {
          // Swallow the click so it doesn't deselect / reach the canvas; a
          // single click no longer opens the modal (double-click edits; the
          // expand traffic-light still opens the full-screen surface).
          e.stopPropagation()
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          // Select the node (show handles) alongside entering edit — the
          // body swallows pointerdown, so the lib's gesture never selects it.
          store.setSelection([id])
          enterEdit()
        }}
        onKeyDown={(e) => {
          if (editing) return
          if (!canEdit) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.stopPropagation()
            enterEdit()
          }
        }}
        className={cn(
          "absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left text-card-foreground shadow-md",
          "pointer-events-auto",
          !editing && canEdit ? "cursor-pointer" : "cursor-default",
        )}
        title={!editing && canEdit ? "Double-click to edit" : undefined}
      >
        <div
          className={cn(
            "min-h-0 flex-1 px-4 pb-3 pt-10 text-sm leading-relaxed text-foreground",
            editing ? "scrollbar-thin overflow-auto" : "overflow-hidden",
          )}
        >
          {iconValue && (
            <div className="pointer-events-none mb-2">
              <IconPropertyView icon={iconValue} size={24} />
            </div>
          )}
          {(body || editing) && isInView ? (
            <div className={editing ? "pointer-events-auto" : "pointer-events-none"}>
              <SheetInlineEditor
                markdown={node.content ?? ""}
                editable={editing}
                pageProvider={pageProvider}
                parentNoteId={id as unknown as string}
                onSave={handleSave}
                onRequestExit={() => setEditing(false)}
              />
            </div>
          ) : body ? (
            // Off-screen: skip the editor mount, show a dimmed placeholder so
            // the card still reads as a sheet at a glance.
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <NotepadIcon className="size-5 shrink-0" />
              <span className="text-xs">Sheet paused</span>
            </div>
          ) : (
            <span className="italic text-muted-foreground">Empty sheet</span>
          )}
        </div>
      </div>

      <NodeTrafficLights
        onDelete={canEdit ? () => store.removeNode(id) : undefined}
        onExpand={canEdit ? () => openNodeSurface(id as unknown as string, "sheet") : undefined}
      />

      <div className="pointer-events-auto absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2">
        <NodeTitleCaption
          nodeId={id}
          label={label}
          placeholder="Untitled"
          textClassName="text-center text-sm font-handwriting text-foreground"
        />
      </div>
    </div>
  )
}
