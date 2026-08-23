export const GENERATED_IMAGE_ACTION_DEADLINE_MS = 30_000


/** Recognize lifecycle cancellation across browser and DOM test realms. */
export function isGeneratedImageActionCancelled(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError"
}


/** Bound one generated-image request independently of fetch abort handling. */
export function runGeneratedImageAction<T>(
  lifecycleSignal: AbortSignal,
  request: (requestSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestController = new AbortController()
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      if (timeout !== null) clearTimeout(timeout)
      lifecycleSignal.removeEventListener("abort", cancel)
    }

    const settle = (complete: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      complete()
    }

    const cancel = (): void => {
      requestController.abort()
      settle(() => reject(new DOMException("Generated image action aborted", "AbortError")))
    }

    const expire = (): void => {
      requestController.abort()
      settle(() => reject(new Error("Generated image action deadline exceeded")))
    }

    if (lifecycleSignal.aborted) {
      cancel()
      return
    }
    lifecycleSignal.addEventListener("abort", cancel, { once: true })
    timeout = setTimeout(expire, GENERATED_IMAGE_ACTION_DEADLINE_MS)

    let operation: Promise<T>
    try {
      operation = request(requestController.signal)
    } catch (error) {
      settle(() => reject(error))
      return
    }
    void operation.then(
      (result) => settle(() => resolve(result)),
      (error: unknown) => settle(() => reject(error)),
    )
  })
}
