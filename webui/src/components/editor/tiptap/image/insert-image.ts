import { toast } from "sonner"
import type { Editor } from "@tiptap/core"
import { downscaleImage } from "@/features/board/components/flow/utils/downscale-image"
import { uploadImage } from "@/features/board/api/upload-image"
import { primeImageCache } from "./image-cache"


/**
 * Shared pipeline for inserting a local image file into the editor: downscale
 * to max 1920x1080, upload to backend, then insert an `<img>` node at the
 * given position (or current selection). Mirrors the canvas pipeline so a
 * single source of truth handles compression + persistence.
 */
export async function insertImageFromFile(
  editor: Editor,
  file: File,
  pos?: number,
): Promise<boolean> {
  if (!file.type.startsWith("image/")) {
    toast.error(`"${file.name}" is not an image`)
    return false
  }

  try {
    const { blob, mimeType } = await downscaleImage(file)
    const ext = mimeType === "image/png" ? "png" : "jpg"
    const base = file.name?.replace(/\.[^.]+$/, "") || "image"
    const { dataUrl, filePath } = await uploadImage(blob, `${base}.${ext}`)

    // Persist the short server `filePath` as `src` so the markdown stays
    // compact (a base64 dataUrl would blow past backend embedding limits).
    // The NodeView resolves filePath → dataUrl for rendering, with a cache
    // pre-warmed here so the freshly-inserted image renders immediately.
    primeImageCache(filePath, dataUrl)

    const insertAt = pos ?? editor.state.selection.from
    editor
      .chain()
      .focus()
      .insertContentAt(insertAt, {
        type: "image",
        attrs: { src: filePath, alt: base },
      })
      .run()
    return true
  } catch (err) {
    console.error("[insertImageFromFile] failed", err)
    toast.error(`Failed to add "${file.name}"`)
    return false
  }
}


/**
 * Open the system file picker and forward the selected files through
 * `insertImageFromFile` one by one. Used by the slash-command entry.
 */
export function pickAndInsertImage(editor: Editor): void {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = "image/*"
  input.multiple = true
  input.onchange = async () => {
    const files = Array.from(input.files ?? [])
    for (const file of files) {
      // sequential so the inserted positions don't clash on rapid uploads
      await insertImageFromFile(editor, file)
    }
  }
  input.click()
}
