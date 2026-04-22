import { useCallback } from "react"
import { toast } from "sonner"

import { useAddNoteNode, type CanvasPoint } from "./use-add-node"
import { uploadImage } from "../api/upload-image"
import { downscaleImage } from "../components/flow/utils/downscale-image"


const IMAGE_NODE_MAX_DIMENSION = 420
const IMAGE_NODE_MIN_DIMENSION = 160


type AddImageOptions = {
  position?: CanvasPoint
  positionOffset?: CanvasPoint
}


/**
 * Canvas display size for an image node: clamp long edge to 420 and short edge
 * to 160 while preserving aspect ratio.
 */
function nodeSizeFromImage(width: number, height: number) {
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


/**
 * Shared pipeline for inserting a local image file as a canvas node: downscale
 * to max 1920x1080, upload to backend, then create an image note. Used by both
 * drag-drop and the dialog import button.
 */
export function useAddImageFromFile() {
  const addNoteNode = useAddNoteNode()

  return useCallback(
    async (file: File, options: AddImageOptions = {}) => {
      try {
        const { blob, width, height, mimeType } = await downscaleImage(file)
        const ext = mimeType === "image/png" ? "png" : "jpg"
        const base = file.name?.replace(/\.[^.]+$/, "") || "image"
        const { dataUrl } = await uploadImage(blob, `${base}.${ext}`)
        const size = nodeSizeFromImage(width, height)
        const position = options.position && options.positionOffset
          ? {
            x: options.position.x + options.positionOffset.x,
            y: options.position.y + options.positionOffset.y,
          }
          : options.position
        addNoteNode({ nodeType: "image", imageUrl: dataUrl, size, position })
        return true
      } catch (err) {
        console.error("[useAddImageFromFile] failed", err)
        toast.error(`Failed to add "${file.name}"`)
        return false
      }
    },
    [addNoteNode],
  )
}
