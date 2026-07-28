import { CloudCheckIcon, MonitorIcon } from "@/components/icons"
import type { BoardKind } from "@/features/board/model"


/**
 * Small pill telling a board apart at a glance: `local-only` → "On device"
 * (monitor glyph), `synced` → "Synced" (cloud glyph). Shown on dashboard cards
 * so the local/remote distinction is per-board, not just group-header deep.
 */
export function BoardKindBadge({ kind }: { kind: BoardKind }) {
  const synced = kind === "synced"
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium " +
        (synced
          ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
          : "bg-muted text-muted-foreground")
      }
      title={synced ? "Synced — backed up and shareable" : "On this device only"}
    >
      {synced ? (
        <CloudCheckIcon className="size-3 shrink-0" strokeWidth={2} />
      ) : (
        <MonitorIcon className="size-3 shrink-0" strokeWidth={2} />
      )}
      {synced ? "Synced" : "On device"}
    </span>
  )
}
