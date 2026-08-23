import { useCallback } from "react"

import { imageGenerationStatusCode } from "@/features/board/api/image-generation"
import { useAuthedBlobUrl } from "@/hooks/use-authed-blob-url"
import { fetchImageHistoryAssetBlob } from "../api/image-history"


/** Load a generation-scoped history image only when its card is near the viewport. */
export function useHistoryImage(
  generationUid: string | null,
  assetUid: string | null,
  enabled: boolean,
) {
  const load = useCallback(
    (signal: AbortSignal) => {
      if (!generationUid || !assetUid) return Promise.reject(new Error("History image is unavailable"))
      return fetchImageHistoryAssetBlob(generationUid, assetUid, signal)
    },
    [assetUid, generationUid],
  )
  return useAuthedBlobUrl({
    requestKey: enabled && generationUid && assetUid ? `${generationUid}:${assetUid}` : null,
    load,
    statusCode: imageGenerationStatusCode,
  })
}
