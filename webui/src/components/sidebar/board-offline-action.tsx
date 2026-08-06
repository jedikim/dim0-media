import { CloudArrowDownIcon, CloudCheckIcon } from "@/components/icons"
import { SidebarMenuAction } from "../ui/sidebar"
import { cn } from "@/lib/utils"
import {
  useBoardOfflineStatus,
  useDownloadBoard,
} from "@/features/board/api/board-offline-status"


/**
 * Trailing offline-availability affordance for a synced board row. Shows a
 * cloud-check when the board's whole graph is persisted locally (readable
 * offline), else a cloud-download to fetch it on demand (pulses while
 * downloading). Sits left of the chats action (`right-8`).
 */
export function BoardOfflineAction({ boardId }: { boardId: string }) {
  const { data: offline } = useBoardOfflineStatus(boardId)
  const download = useDownloadBoard()
  const downloading = download.isPending

  // Still resolving the idb read — render nothing rather than flash the download
  // affordance on a board that turns out to already be offline-available.
  if (offline === undefined) return null
  if (offline) {
    return (
      <SidebarMenuAction
        className="right-8 text-secondary-foreground/50 hover:bg-transparent cursor-default"
        title="Available offline"
        aria-label="Available offline"
        tabIndex={-1}
      >
        <CloudCheckIcon className="size-4" strokeWidth={2} />
      </SidebarMenuAction>
    )
  }

  return (
    <SidebarMenuAction
      className={cn(
        "right-8 text-muted-foreground/40 hover:text-secondary-foreground hover:bg-transparent",
        downloading && "opacity-60",
      )}
      onClick={(e) => {
        e.stopPropagation()
        if (!downloading) download.mutate(boardId)
      }}
      title={downloading ? "Downloading for offline…" : "Download for offline use"}
      aria-label={downloading ? "Downloading for offline" : "Download for offline use"}
    >
      <CloudArrowDownIcon
        className={cn("size-4", downloading && "animate-pulse")}
        strokeWidth={2}
      />
    </SidebarMenuAction>
  )
}
