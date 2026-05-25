import { useCallback, type RefObject } from "react"
import { screenToWorld, type CanvasStore } from "@canvas-harness/core"
import { useHarnessAddImage } from "./use-add-image"


const STAGGER_PX = 24


/**
 * Walk a DataTransfer for image files. Mirrors prod's
 * extractImageFiles: prefer `dt.items` (richer mime sniffing) and fall
 * back to `dt.files` only when the items API didn't yield anything.
 */
const extractImageFiles = (dt: DataTransfer): File[] => {
  const files: File[] = []
  if (dt.items && dt.items.length > 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== "file") continue
      const file = item.getAsFile()
      if (file && file.type.startsWith("image/")) files.push(file)
    }
    if (files.length > 0) return files
  }
  if (dt.files && dt.files.length > 0) {
    for (const file of Array.from(dt.files)) {
      if (file.type.startsWith("image/")) files.push(file)
    }
  }
  return files
}


/**
 * Drag-drop adapter for the harness canvas. Returns
 * `{ onDragOver, onDrop }` to spread onto the canvas wrap. Image files
 * are downscaled + uploaded + added as image nodes at the world-space
 * drop point (centered on the cursor, slight stagger between siblings
 * when multi-dropping). Non-image drops are left alone so the
 * browser's default behavior or other consumers can claim them.
 */
export const useHarnessDropFiles = (
  wrapRef: RefObject<HTMLElement | null>,
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
  enabled: boolean,
): {
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void
} => {
  const addImage = useHarnessAddImage(store, boardId, rootId)

  const onDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!enabled) return
      const dt = event.dataTransfer
      if (!dt) return
      const hasFile = Array.from(dt.items ?? []).some((i) => i.kind === "file")
      if (!hasFile) return
      event.preventDefault()
      dt.dropEffect = "copy"
    },
    [enabled],
  )

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (!enabled) return
      const dt = event.dataTransfer
      if (!dt) return
      const files = extractImageFiles(dt)
      if (files.length === 0) return

      event.preventDefault()
      const wrap = wrapRef.current
      const rect = wrap?.getBoundingClientRect()
      const screen = rect
        ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
        : { x: event.clientX, y: event.clientY }
      const world = screenToWorld(screen, store.getCamera())

      await Promise.all(
        files.map((file, index) =>
          addImage(file, {
            position: world,
            positionOffset: { x: index * STAGGER_PX, y: index * STAGGER_PX },
          }),
        ),
      )
    },
    [enabled, wrapRef, store, addImage],
  )

  return { onDragOver, onDrop }
}
