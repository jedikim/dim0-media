import { apiFetch } from "@/api"


type GetFileResponse = {
  data: {
    base64_url: string
  }
}


// Module-level cache so re-renders of the same image don't re-fetch.
const _cache = new Map<string, string>()
const _inflight = new Map<string, Promise<string>>()


/** Pre-fill the cache (called right after a fresh upload). */
export function primeImageCache(filePath: string, dataUrl: string): void {
  _cache.set(filePath, dataUrl)
}


/** True for URLs the browser can render natively — no resolution needed. */
export function isDirectImageSrc(src: string): boolean {
  return (
    src.startsWith("data:") ||
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("blob:")
  )
}


/**
 * Resolve a server-side filePath (e.g. "file://abc.jpg") to a renderable
 * data URL via GET /files. Cached + de-duplicated across concurrent calls.
 */
export async function resolveImageSrc(filePath: string): Promise<string> {
  const cached = _cache.get(filePath)
  if (cached) return cached

  const pending = _inflight.get(filePath)
  if (pending) return pending

  const promise = (async () => {
    const resolved = await apiFetch<GetFileResponse>({
      path: "/files",
      method: "GET",
      params: { filename: filePath },
    })
    const dataUrl = resolved.data?.base64_url
    if (!dataUrl) throw new Error("File lookup response missing base64_url")
    _cache.set(filePath, dataUrl)
    _inflight.delete(filePath)
    return dataUrl
  })()
  _inflight.set(filePath, promise)
  return promise
}
