import { useCallback } from "react"
import { toast } from "sonner"
import type { CanvasStore } from "@canvas-harness/core"
import { uploadImage } from "@/features/board/api/upload-image"
import { downscaleImage } from "@/features/board/components/flow/utils/downscale-image"
import { createDefaultNote } from "@/features/board/types/note"
import { noteToNode } from "../convert/note-to-node"


const IMAGE_NODE_MAX_DIMENSION = 420
const IMAGE_NODE_MIN_DIMENSION = 160


/**
 * Clamp the long edge to 420 and short edge to 160 while preserving the
 * source aspect ratio. Matches prod's [use-add-image-from-file] math so
 * dropped images render at the same size on both code paths.
 */
const nodeSizeFromImage = (
  width: number,
  height: number,
): { width: number; height: number } => {
  const ratio = width / height
  if (ratio >= 1) {
    let w = IMAGE_NODE_MAX_DIMENSION
    let h = w / ratio
    if (h < IMAGE_NODE_MIN_DIMENSION) {
      h = IMAGE_NODE_MIN_DIMENSION
      w = h * ratio
    }
    return { width: Math.round(w), height: Math.round(h) }
  }
  let h = IMAGE_NODE_MAX_DIMENSION
  let w = h * ratio
  if (w < IMAGE_NODE_MIN_DIMENSION) {
    w = IMAGE_NODE_MIN_DIMENSION
    h = w / ratio
  }
  return { width: Math.round(w), height: Math.round(h) }
}


export type AddImageOptions = {
  /** World-space coordinate the image should be centered on. */
  position?: { x: number; y: number }
  /** Optional offset added on top of `position` (used to stagger multi-drops). */
  positionOffset?: { x: number; y: number }
}


/**
 * Harness-native image insertion: downscale the file client-side,
 * upload via the existing image API, build a Note carrying the
 * resulting data URL, convert + add to the canvas store. Mirrors
 * prod's `useAddImageFromFile` but bypasses the legacy graph-store so
 * the dropped image actually lands on the harness canvas.
 */
export const useHarnessAddImage = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
) => {
  return useCallback(
    async (file: File, options: AddImageOptions = {}): Promise<boolean> => {
      if (!boardId) return false
      try {
        const { blob, width, height, mimeType } = await downscaleImage(file)
        const ext = mimeType === "image/png" ? "png" : "jpg"
        const base = file.name?.replace(/\.[^.]+$/, "") || "image"
        const { dataUrl } = await uploadImage(blob, `${base}.${ext}`)
        const size = nodeSizeFromImage(width, height)

        const center = options.position
          ? {
              x: options.position.x + (options.positionOffset?.x ?? 0),
              y: options.position.y + (options.positionOffset?.y ?? 0),
            }
          : { x: 0, y: 0 }
        const position = {
          x: center.x - size.width / 2,
          y: center.y - size.height / 2,
        }

        const note = createDefaultNote({ boardId, nodeType: "image" })
        if (rootId) note.parentId = rootId
        note.properties.imageUrl = { type: "image", image: { url: dataUrl } }
        note.properties.nodeSize = { type: "size", size }
        note.properties.nodePosition = { type: "position", position }

        store.addNode(noteToNode(note))
        return true
      } catch (err) {
        console.error("[useHarnessAddImage] failed", err)
        toast.error(`Failed to add "${file.name}"`)
        return false
      }
    },
    [store, boardId, rootId],
  )
}
