import { useCallback } from "react"

import {
  AUTHED_BLOB_ATTEMPT_DEADLINE_MS,
  AUTHED_BLOB_MAX_ATTEMPTS,
  AUTHED_BLOB_RETRY_BASE_MS,
  AUTHED_BLOB_TOTAL_DEADLINE_MS,
  useAuthedBlobUrl,
} from "@/hooks/use-authed-blob-url"
import {
  fetchImageAssetBlob,
  imageGenerationStatusCode,
} from "../api/image-generation"


export const AUTHED_IMAGE_MAX_ATTEMPTS = AUTHED_BLOB_MAX_ATTEMPTS
export const AUTHED_IMAGE_RETRY_BASE_MS = AUTHED_BLOB_RETRY_BASE_MS
export const AUTHED_IMAGE_ATTEMPT_DEADLINE_MS = AUTHED_BLOB_ATTEMPT_DEADLINE_MS
export const AUTHED_IMAGE_TOTAL_DEADLINE_MS = AUTHED_BLOB_TOTAL_DEADLINE_MS


/** Load a protected board image and revoke its object URL on replacement. */
export function useAuthedImage(graphId: string | null, assetUid: string | null) {
  const load = useCallback(
    (signal: AbortSignal) => {
      if (!graphId || !assetUid) return Promise.reject(new Error("Image asset is unavailable"))
      return fetchImageAssetBlob(graphId, assetUid, signal)
    },
    [assetUid, graphId],
  )
  return useAuthedBlobUrl({
    requestKey: graphId && assetUid ? `${graphId}:${assetUid}` : null,
    load,
    statusCode: imageGenerationStatusCode,
  })
}
