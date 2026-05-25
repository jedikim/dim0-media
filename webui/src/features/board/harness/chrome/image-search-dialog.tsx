import { useCallback, useRef, useState } from "react"
import { screenToWorld } from "@canvas-harness/core"
import { useCanvasStore } from "@canvas-harness/react"
import { ImagePlaceholderIcon } from "@/components/icons"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useSearchImages } from "@/features/board/api/image-search"
import { useDebouncedValue } from "@/features/board/hooks/use-debounce"
import { useHarnessAddImage } from "../canvas/use-add-image"
import { useHarnessWrapRef } from "../canvas/wrap-ref-context"
import { useBoardAppStore } from "../store/board-app-store"


export type ImageSearchDialogProps = {
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
) => {
  if (!wrap) return { x: 0, y: 0 }
  const rect = wrap.getBoundingClientRect()
  return screenToWorld(
    { x: rect.width / 2, y: rect.height / 2 },
    store.getCamera(),
  )
}


/**
 * Body of the image-search dialog. Lazy-mounted so the search grid
 * and its image decoding only runs while the dialog is open.
 */
const ImageSearchDialogBody = ({
  onClose,
}: {
  onClose: () => void
}) => {
  const store = useCanvasStore()
  const wrapRef = useHarnessWrapRef()
  const boardId = useBoardAppStore((s) => s.boardId)
  const rootId = useBoardAppStore((s) => s.rootId)
  const addImage = useHarnessAddImage(store, boardId, rootId)

  const [q, setQ] = useState("")
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const debouncedQ = useDebouncedValue<string>({ value: q, delay: 1000 })
  const { data, isLoading } = useSearchImages({ query: debouncedQ })

  const placementAt = useCallback(() => {
    const center = viewportCenterWorld(wrapRef?.current ?? null, store)
    const jitter = () => Math.random() * PLACEMENT_JITTER_PX - PLACEMENT_JITTER_PX / 2
    return { x: center.x + jitter(), y: center.y + jitter() }
  }, [wrapRef, store])

  const handleSelectImage = useCallback(
    async (imgUrl: string) => {
      try {
        const res = await fetch(imgUrl)
        const blob = await res.blob()
        const fileName = imgUrl.split("/").pop()?.split("?")[0] || "image.jpg"
        const file = new File([blob], fileName, { type: blob.type || "image/jpeg" })
        await addImage(file, { position: placementAt() })
      } finally {
        onClose()
      }
    },
    [addImage, placementAt, onClose],
  )

  const handleFilesPicked = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return
      setIsImporting(true)
      try {
        const files = Array.from(fileList).filter((f) =>
          f.type.startsWith("image/"),
        )
        const base = placementAt()
        await Promise.all(
          files.map((file, index) =>
            addImage(file, {
              position: base,
              positionOffset: { x: index * 24, y: index * 24 },
            }),
          ),
        )
        onClose()
      } finally {
        setIsImporting(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    },
    [addImage, placementAt, onClose],
  )

  return (
    <>
      <DialogHeader className="w-full border-b p-4 text-center text-secondary-foreground">
        <DialogTitle>Search images</DialogTitle>
      </DialogHeader>
      <div className="p-4">
        <Input
          placeholder="Search Unsplash…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          className="focus-visible:border-secondary-foreground focus-visible:ring-2 focus-visible:ring-secondary-foreground/75"
        />
      </div>
      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-secondary-foreground/75 hover:bg-muted/50 hover:text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ImagePlaceholderIcon className="size-4 shrink-0" />
          <span>{isImporting ? "Importing…" : "Import from computer"}</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void handleFilesPicked(e.target.files)}
        />
      </div>
      <div className="scrollbar-thin h-full w-full flex-1 overflow-y-auto p-4 pt-2">
        {isLoading ? (
          <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        ) : (
          <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
            {data?.map((img) => (
              <button
                key={img.url}
                className="group relative aspect-square overflow-hidden rounded-md border hover:ring-2 hover:ring-secondary-foreground/75"
                onClick={() => {
                  void handleSelectImage(img.url)
                }}
              >
                <img
                  src={img.url}
                  alt={img.description || "image"}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                />
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
 * Harness port of prod's ImageSearchDialog. Search results +
 * file-picker fallback both route through `useHarnessAddImage` so the
 * image lands on the canvas-harness store (not the legacy graph
 * store).
 */
export const ImageSearchDialog = ({
  open,
  onOpenChange,
}: ImageSearchDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex flex-col overflow-hidden p-0 sm:h-[50vh] sm:w-1/3 sm:max-w-2xl">
      {open && <ImageSearchDialogBody onClose={() => onOpenChange(false)} />}
    </DialogContent>
  </Dialog>
)
