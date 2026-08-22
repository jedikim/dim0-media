import { useEffect, useState } from "react"

import {
  fetchImageAssetBlob,
  imageGenerationStatusCode,
} from "../api/image-generation"


export const AUTHED_IMAGE_MAX_ATTEMPTS = 3
export const AUTHED_IMAGE_RETRY_BASE_MS = 250


/** Return whether one authenticated blob failure is safe to retry. */
function isTransientBlobFailure(error: unknown): boolean {
  const status = imageGenerationStatusCode(error)
  return error instanceof TypeError
    || status === 408
    || status === 429
    || (status !== null && status >= 500)
}


/** Load a protected image asset and revoke its object URL on replacement or unmount. */
export function useAuthedImage(graphId: string | null, assetUid: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setUrl(null)
    setFailed(false)
    if (!graphId || !assetUid) return

    const controller = new AbortController()
    let alive = true
    let objectUrl: string | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const waitForRetry = (delayMs: number): Promise<void> => new Promise((resolve) => {
      const finish = (): void => {
        if (retryTimer !== null) clearTimeout(retryTimer)
        retryTimer = null
        controller.signal.removeEventListener("abort", finish)
        resolve()
      }
      retryTimer = setTimeout(finish, delayMs)
      controller.signal.addEventListener("abort", finish, { once: true })
    })

    const load = async (): Promise<void> => {
      for (let attempt = 1; attempt <= AUTHED_IMAGE_MAX_ATTEMPTS; attempt += 1) {
        try {
          const blob = await fetchImageAssetBlob(graphId, assetUid, controller.signal)
          if (!alive || controller.signal.aborted) return
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
          return
        } catch (error) {
          if (
            !alive
            || controller.signal.aborted
            || (error instanceof Error && error.name === "AbortError")
          ) return
          if (!isTransientBlobFailure(error) || attempt === AUTHED_IMAGE_MAX_ATTEMPTS) {
            setFailed(true)
            return
          }
          await waitForRetry(AUTHED_IMAGE_RETRY_BASE_MS * (2 ** (attempt - 1)))
          if (!alive || controller.signal.aborted) return
        }
      }
    }
    void load()

    return () => {
      alive = false
      if (retryTimer !== null) clearTimeout(retryTimer)
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [assetUid, graphId])

  return { url, failed }
}
