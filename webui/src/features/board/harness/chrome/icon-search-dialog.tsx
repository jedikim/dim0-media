import { useCallback, useState } from "react"
import { Icon } from "@iconify/react"
import { screenToWorld } from "@canvas-harness/core"
import { useCanvasStore } from "@canvas-harness/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useSearchIcons } from "@/features/board/api/icon-search"
import { useDebouncedValue } from "@/features/board/hooks/use-debounce"
import { cn } from "@/lib/utils"
import { useHarnessAddIcon } from "../canvas/use-add-icon"
import { useHarnessWrapRef } from "../canvas/wrap-ref-context"
import { useBoardAppStore } from "../store/board-app-store"


export type IconSearchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}


const PLACEMENT_JITTER_PX = 50


/**
 * Compute the current viewport center in world coords. Fallback to
 * `{ 0, 0 }` if the wrap isn't measurable (shouldn't happen in
 * practice but keeps the dialog usable as a degenerate case).
 */
const viewportCenterWorld = (
  wrap: HTMLElement | null,
  store: ReturnType<typeof useCanvasStore>,
): { x: number; y: number } => {
  if (!wrap) return { x: 0, y: 0 }
  const rect = wrap.getBoundingClientRect()
  return screenToWorld(
    { x: rect.width / 2, y: rect.height / 2 },
    store.getCamera(),
  )
}


/**
 * Iconify-driven preview tile. Uses the same `@iconify/react` Icon
 * component as prod's dialog so search results render in-grid without
 * an extra network roundtrip per icon.
 */
const ThemedIcon = ({ iconName, className }: { iconName: string; className?: string }) => (
  <Icon icon={iconName} width="32" className={cn("text-card-foreground", className)} />
)


/**
 * Lazy body for the harness icon search dialog. Mounted only while
 * the dialog is open so the iconify network/decoding cost for hundreds
 * of icons doesn't linger across open/close cycles.
 */
const IconSearchDialogBody = ({
  onClose,
}: {
  onClose: () => void
}) => {
  const store = useCanvasStore()
  const wrapRef = useHarnessWrapRef()
  const boardId = useBoardAppStore((s) => s.boardId)
  const rootId = useBoardAppStore((s) => s.rootId)
  const addIcon = useHarnessAddIcon(store, boardId, rootId)

  const [q, setQ] = useState("")
  const debouncedQ = useDebouncedValue<string>({ value: q, delay: 1000 })
  const { data, isLoading } = useSearchIcons({ query: debouncedQ })

  const placementAt = useCallback(() => {
    const center = viewportCenterWorld(wrapRef?.current ?? null, store)
    const jitter = () => Math.random() * PLACEMENT_JITTER_PX - PLACEMENT_JITTER_PX / 2
    return { x: center.x + jitter(), y: center.y + jitter() }
  }, [wrapRef, store])

  const handleSelectIcon = useCallback(
    async (iconName: string) => {
      try {
        await addIcon(iconName, { position: placementAt() })
      } finally {
        onClose()
      }
    },
    [addIcon, placementAt, onClose],
  )

  return (
    <>
      <DialogHeader className="w-full border-b p-4 text-center text-secondary-foreground">
        <DialogTitle>Search icons</DialogTitle>
      </DialogHeader>
      <div className="p-4">
        <Input
          placeholder="Search Icon…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          className="focus-visible:border-secondary-foreground focus-visible:ring-2 focus-visible:ring-secondary-foreground/75"
        />
      </div>
      <div className="scrollbar-thin h-full w-full flex-1 overflow-y-auto p-4 pt-2">
        {isLoading ? (
          <div className="grid w-full grid-cols-5 gap-1 sm:grid-cols-10">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        ) : (
          <div className="grid w-full grid-cols-5 gap-1 sm:grid-cols-10">
            {data?.map((icon) => (
              <button
                key={icon.url}
                className="group relative grid aspect-square place-items-center rounded-md border bg-card p-1 hover:ring-2 hover:ring-secondary-foreground/75"
                title={icon.name}
                onClick={() => {
                  void handleSelectIcon(icon.name)
                }}
              >
                <ThemedIcon iconName={icon.name} />
              </button>
            ))}
            {debouncedQ && !data?.length && (
              <div className="col-span-full p-4 text-sm text-muted-foreground">
                No results
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}


/**
 * Harness port of prod's IconSearchDialog. Routes the selected icon
 * through `useHarnessAddIcon` so the new node lands on the canvas-
 * harness store with its SVG markup pre-loaded for immediate paint.
 */
export const IconSearchDialog = ({
  open,
  onOpenChange,
}: IconSearchDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex flex-col overflow-hidden p-0 sm:h-[50vh] sm:w-1/3 sm:max-w-xl">
      {open && <IconSearchDialogBody onClose={() => onOpenChange(false)} />}
    </DialogContent>
  </Dialog>
)
