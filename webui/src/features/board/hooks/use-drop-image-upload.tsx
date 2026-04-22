import { useCallback } from "react"

import { useAddImageFromFile } from "./use-add-image-from-file"


type ScreenToFlow = (point: { x: number; y: number }) => { x: number; y: number }


type UseDropImageUploadOptions = {
  enabled: boolean
  screenToFlowPosition: ScreenToFlow
}


function extractImageFiles(dt: DataTransfer): File[] {
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
 * Accept image files dropped onto the canvas: each file is downscaled, uploaded,
 * and inserted as an image node near the drop location.
 */
export function useDropImageUpload({ enabled, screenToFlowPosition }: UseDropImageUploadOptions) {
  const addImage = useAddImageFromFile()

  const onDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!enabled) return
      const dt = event.dataTransfer
      if (!dt) return
      const hasFile = Array.from(dt.items ?? []).some(i => i.kind === "file")
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

      const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY })

      await Promise.all(
        files.map((file, index) =>
          addImage(file, {
            position: origin,
            positionOffset: { x: index * 24, y: index * 24 },
          }),
        ),
      )
    },
    [enabled, screenToFlowPosition, addImage],
  )

  return { onDragOver, onDrop }
}
