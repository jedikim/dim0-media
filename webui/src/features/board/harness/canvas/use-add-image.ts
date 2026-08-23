import { useCallback } from "react"
import { toast } from "sonner"
import type { CanvasStore, NodeId } from "@canvas-harness/core"
import { uploadImage } from "@/features/board/api/upload-image"
import {
  imageGenerationStatusCode,
  uploadImageAsset,
  type ImageAssetUpload,
} from "@/features/board/api/image-generation"
import { downscaleImage } from "@/features/board/components/flow/utils/downscale-image"
import { createDefaultNote } from "@/features/board/types/note"
import { noteToNode } from "../convert/note-to-node"
import { blobToDataUrl } from "../image-reference-assets"
import { useBoardAppStore } from "../store/board-app-store"
import { useBoardRuntime } from "./board-runtime-context"


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
  /** Optional final top-left resolver evaluated after the image size is known. */
  resolvePosition?: (size: { width: number; height: number }) => { x: number; y: number }
}


/** Return whether a synced asset upload may safely fall back to lazy registration. */
export function isTransientImageAssetUploadError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return false
  const status = imageGenerationStatusCode(error)
  if (status !== null) return status === 429 || status >= 500
  return error instanceof TypeError
}


/**
 * Add a downscaled image node, eagerly registering synced assets when possible.
 * Transient synced upload failures retain a data URL for lazy registration.
 */
export const useHarnessAddImage = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
) => {
  const { local } = useBoardRuntime()
  const canEdit = useBoardAppStore((state) => state.canEdit)
  return useCallback(
    async (file: File, options: AddImageOptions = {}): Promise<NodeId | null> => {
      if (!boardId || !canEdit) return null
      try {
        const { blob, width, height, mimeType } = await downscaleImage(file)
        const ext = mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
          ? "webp"
          : "jpg"
        const base = file.name?.replace(/\.[^.]+$/, "") || "image"
        const filename = `${base}.${ext}`
        const dataUrl = local
          ? (await uploadImage(blob, filename)).dataUrl
          : await blobToDataUrl(blob)
        let asset: ImageAssetUpload | null = null
        if (!local) {
          try {
            asset = await uploadImageAsset(boardId, blob, filename)
          } catch (error) {
            if (!isTransientImageAssetUploadError(error)) throw error
          }
        }
        const size = nodeSizeFromImage(width, height)

        const center = options.position
          ? {
              x: options.position.x + (options.positionOffset?.x ?? 0),
              y: options.position.y + (options.positionOffset?.y ?? 0),
            }
          : { x: 0, y: 0 }
        const position = options.resolvePosition?.(size) ?? {
          x: center.x - size.width / 2,
          y: center.y - size.height / 2,
        }

        const note = createDefaultNote({ boardId, nodeType: "image" })
        if (rootId) note.parentId = rootId
        note.properties.imageUrl = { type: "image", image: { url: dataUrl } }
        if (asset) {
          note.properties.imageAssetUid = { type: "keyword", value: asset.asset_uid }
        }
        note.properties.nodeSize = { type: "size", size }
        note.properties.nodePosition = { type: "position", position }

        const id = store.addNode(noteToNode(note))
        store.setSelection([id])
        return id
      } catch {
        console.error("[useHarnessAddImage] failed")
        toast.error(`Failed to add "${file.name}"`)
        return null
      }
    },
    [store, boardId, rootId, local, canEdit],
  )
}
