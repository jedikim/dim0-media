/**
 * Local thumbnail sink — the offline analog of the backend's `saveThumbnail`
 * (which POSTs a blob to the server). Here the PNG blob is encoded as a data URL
 * and stored on the board's `BoardMeta.thumbnail` via the shared registry, so the
 * local dashboard can render it. Best-effort; called from the capture hook.
 */
import { getLocalStores } from "@/features/local-stores"


/** Encode a Blob as a base64 data URL. */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"))
    reader.readAsDataURL(blob)
  })


/** Persist a board's captured thumbnail locally (data URL on BoardMeta). */
export const saveLocalThumbnail = async ({ boardId, blob }: { boardId: string; blob: Blob }): Promise<void> => {
  const dataUrl = await blobToDataUrl(blob)
  const { boards } = await getLocalStores()
  await boards.setThumbnail(boardId, dataUrl)
}
