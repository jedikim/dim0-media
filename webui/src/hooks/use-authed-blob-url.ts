import { useEffect, useState } from "react"


export const AUTHED_BLOB_MAX_ATTEMPTS = 3
export const AUTHED_BLOB_RETRY_BASE_MS = 250
export const AUTHED_BLOB_ATTEMPT_DEADLINE_MS = 10_000
export const AUTHED_BLOB_TOTAL_DEADLINE_MS = 30_000


class AuthedBlobDeadlineError extends Error {
  /** Identify a bounded authenticated blob request timeout. */

  constructor() {
    super("Authenticated blob request deadline exceeded")
    this.name = "AuthedBlobDeadlineError"
  }
}


/** Return whether one authenticated blob failure is safe to retry. */
function isTransientBlobFailure(error: unknown, statusCode: (error: unknown) => number | null): boolean {
  const status = statusCode(error)
  return error instanceof AuthedBlobDeadlineError
    || error instanceof TypeError
    || status === 408
    || status === 429
    || (status !== null && status >= 500)
}


/** Load authenticated bytes with bounded retries and revoke stale object URLs. */
export function useAuthedBlobUrl({
  requestKey,
  load,
  statusCode,
}: {
  requestKey: string | null
  load: (signal: AbortSignal) => Promise<Blob>
  statusCode: (error: unknown) => number | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setUrl(null)
    setFailed(false)
    if (!requestKey) return

    const lifecycleController = new AbortController()
    let alive = true
    let objectUrl: string | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attemptController: AbortController | null = null
    const deadlineAt = Date.now() + AUTHED_BLOB_TOTAL_DEADLINE_MS

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
      if (remainingMs <= 0) return Promise.reject(new AuthedBlobDeadlineError())
      attemptController = new AbortController()
      const controller = attemptController
      let timeout: ReturnType<typeof setTimeout> | null = null
      let onLifecycleAbort: (() => void) | null = null
      const bounded = new Promise<Blob>((resolve, reject) => {
        onLifecycleAbort = (): void => {
          controller.abort()
          reject(new DOMException("Authenticated blob request aborted", "AbortError"))
        }
        lifecycleController.signal.addEventListener("abort", onLifecycleAbort, { once: true })
        timeout = setTimeout(() => {
          controller.abort()
          reject(new AuthedBlobDeadlineError())
        }, Math.min(AUTHED_BLOB_ATTEMPT_DEADLINE_MS, remainingMs))
        void load(controller.signal).then(resolve, reject)
      })
      return bounded.finally(() => {
        if (timeout !== null) clearTimeout(timeout)
        if (onLifecycleAbort !== null) lifecycleController.signal.removeEventListener("abort", onLifecycleAbort)
        if (attemptController === controller) attemptController = null
      })
    }

    const run = async (): Promise<void> => {
      for (let attempt = 1; attempt <= AUTHED_BLOB_MAX_ATTEMPTS; attempt += 1) {
        try {
          const blob = await fetchWithDeadline()
          if (!alive || lifecycleController.signal.aborted) return
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
          return
        } catch (error) {
          if (!alive || lifecycleController.signal.aborted || (error instanceof Error && error.name === "AbortError")) return
          if (error instanceof AuthedBlobDeadlineError && Date.now() >= deadlineAt) {
            setFailed(true)
            return
          }
          if (!isTransientBlobFailure(error, statusCode) || attempt === AUTHED_BLOB_MAX_ATTEMPTS) {
            setFailed(true)
            return
          }
          const retryDelay = AUTHED_BLOB_RETRY_BASE_MS * (2 ** (attempt - 1))
          if (Date.now() + retryDelay >= deadlineAt) {
            setFailed(true)
            return
          }
          await waitForRetry(retryDelay)
          if (!alive || lifecycleController.signal.aborted) return
        }
      }
    }
    void run()

    return () => {
      alive = false
      if (retryTimer !== null) clearTimeout(retryTimer)
      lifecycleController.abort()
      attemptController?.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [load, requestKey, statusCode])

  return { url, failed }
}
