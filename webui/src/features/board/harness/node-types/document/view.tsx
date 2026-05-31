import { FilePdf, File as FileIcon, Clock, CheckCircle, Warning } from "@phosphor-icons/react"
import { type NodeId } from "@canvas-harness/core"
import { useCanvasStore, useNode } from "@canvas-harness/react"
import { cn } from "@/lib/utils"
import type { NoteNodeData } from "../../convert/note-to-node"
import { NodeTitleCaption, NodeTrafficLights } from "../../shared-views"
import { useBoardAppStore } from "../../store/board-app-store"


export type DocumentViewProps = {
  id: NodeId
}


const STATUS_META: Record<
  string,
  { label: string; tone: string; icon: typeof Clock }
> = {
  pending: { label: "Pending", tone: "text-muted-foreground", icon: Clock },
  processing: { label: "Processing", tone: "text-amber-600 dark:text-amber-400", icon: Clock },
  completed: { label: "Ready", tone: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle },
  failed: { label: "Failed", tone: "text-destructive", icon: Warning },
}


/**
 * Document node view — file icon + processing status. Doubles as the
 * inline node card; opening the file viewer lands in phase 5.2.
 * Editable filename sits below the card via NodeTitleCaption.
 */
export function DocumentView({ id }: DocumentViewProps) {
  const node = useNode(id)
  const store = useCanvasStore()
  const canEdit = useBoardAppStore((s) => s.canEdit)
  if (!node) return null

  const data = (node.data ?? {}) as Partial<NoteNodeData>
  const filename = data.label?.markdown?.trim() || undefined
  const mime = data.properties?.mimeType?.text
  const status = data.properties?.status?.value
  const isPdf = mime?.includes("pdf") ?? filename?.toLowerCase().endsWith(".pdf")
  const Icon = isPdf ? FilePdf : FileIcon

  const statusMeta = status ? STATUS_META[status] : null
  const StatusIcon = statusMeta?.icon

  return (
    <div className="pointer-events-none relative h-full w-full select-none">
      <NodeTrafficLights
        onDelete={canEdit ? () => store.removeNode(id) : undefined}
      />

      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-foreground",
        )}
      >
        <Icon className="size-12 opacity-80" weight="duotone" />
        {statusMeta && StatusIcon ? (
          <div className={cn("flex items-center gap-1 text-xs", statusMeta.tone)}>
            <StatusIcon className="size-3" weight="fill" />
            <span>{statusMeta.label}</span>
          </div>
        ) : null}
      </div>

      <div className="pointer-events-auto absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2">
        <NodeTitleCaption
          nodeId={id}
          label={filename}
          placeholder="Untitled file"
          textClassName="text-center text-sm font-handwriting text-foreground"
        />
      </div>
    </div>
  )
}
