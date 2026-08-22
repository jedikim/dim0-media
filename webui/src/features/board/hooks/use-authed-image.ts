import { useEffect, useState } from "react"

import {
  fetchImageAssetBlob,
  imageGenerationStatusCode,
} from "../api/image-generation"


export const AUTHED_IMAGE_MAX_ATTEMPTS = 3
export const AUTHED_IMAGE_RETRY_BASE_MS = 250
export const AUTHED_IMAGE_ATTEMPT_DEADLINE_MS = 10_000
export const AUTHED_IMAGE_TOTAL_DEADLINE_MS = 30_000


class AuthedImageDeadlineError extends Error {
  /** Identify a bounded authenticated image request timeout. */

  constructor() {
    super("Authenticated image request deadline exceeded")
    this.name = "AuthedImageDeadlineError"
  }
}


/** Return whether one authenticated blob failure is safe to retry. */
function isTransientBlobFailure(error: unknown): boolean {
  const status = imageGenerationStatusCode(error)
  return error instanceof AuthedImageDeadlineError
    || error instanceof TypeError
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

    const lifecycleController = new AbortController()
    let alive = true
    let objectUrl: string | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attemptController: AbortController | null = null
    const deadlineAt = Date.now() + AUTHED_IMAGE_TOTAL_DEADLINE_MS

    const waitForRetry = (delayMs: number): Promise<void> => new Promise((resolve) => {
      const finish = (): void => {
        if (retryTimer !== null) clearTimeout(retryTimer)
        retryTimer = null
        lifecycleController.signal.removeEventListener("abort", finish)
        resolve()
      }
      retryTimer = setTimeout(finish, delayMs)
      lifecycleController.signal.addEventListener("abort", finish, { once: true })
    })

    const fetchWithDeadline = (): Promise<Blob> => {
      const remainingMs = deadlineAt - Date.now()
      if (remainingMs <= 0) return Promise.reject(new AuthedImageDeadlineError())
      attemptController = new AbortController()
      const controller = attemptController
      let timeout: ReturnType<typeof setTimeout> | null = null
      let onLifecycleAbort: (() => void) | null = null
      const bounded = new Promise<Blob>((resolve, reject) => {
        onLifecycleAbort = (): void => {
          controller.abort()
          reject(new DOMException("Authenticated image request aborted", "AbortError"))
        }
        lifecycleController.signal.addEventListener("abort", onLifecycleAbort, { once: true })
        timeout = setTimeout(() => {
          controller.abort()
          reject(new AuthedImageDeadlineError())
        }, Math.min(AUTHED_IMAGE_ATTEMPT_DEADLINE_MS, remainingMs))
        void fetchImageAssetBlob(graphId, assetUid, controller.signal).then(resolve, reject)
      })
      return bounded.finally(() => {
        if (timeout !== null) clearTimeout(timeout)
        if (onLifecycleAbort !== null) {
          lifecycleController.signal.removeEventListener("abort", onLifecycleAbort)
        }
        if (attemptController === controller) attemptController = null
      })
    }

    const load = async (): Promise<void> => {
      for (let attempt = 1; attempt <= AUTHED_IMAGE_MAX_ATTEMPTS; attempt += 1) {
        try {
          const blob = await fetchWithDeadline()
          if (!alive || lifecycleController.signal.aborted) return
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
          return
        } catch (error) {
          if (
            !alive
            || lifecycleController.signal.aborted
            || (error instanceof Error && error.name === "AbortError")
          ) return
          if (error instanceof AuthedImageDeadlineError && Date.now() >= deadlineAt) {
            setFailed(true)
            return
          }
          if (!isTransientBlobFailure(error) || attempt === AUTHED_IMAGE_MAX_ATTEMPTS) {
            setFailed(true)
            return
          }
          const retryDelay = AUTHED_IMAGE_RETRY_BASE_MS * (2 ** (attempt - 1))
          if (Date.now() + retryDelay >= deadlineAt) {
            setFailed(true)
            return
          }
          await waitForRetry(retryDelay)
          if (!alive || lifecycleController.signal.aborted) return
        }
      }
    }
    void load()

    return () => {
      alive = false
      if (retryTimer !== null) clearTimeout(retryTimer)
      lifecycleController.abort()
      attemptController?.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [assetUid, graphId])

  return { url, failed }
}
