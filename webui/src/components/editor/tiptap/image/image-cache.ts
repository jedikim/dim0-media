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
 *
 * The src may arrive URL-encoded (from a markdown-it round-trip) or with
 * literal characters (right after insert). Decode so the cache key and
 * filename param always match the server's view of the file path.
 */
export async function resolveImageSrc(filePath: string): Promise<string> {
  let key = filePath
  try {
    key = decodeURI(filePath)
  } catch {
    // malformed escape sequence — fall back to the raw string
  }

  const cached = _cache.get(key)
  if (cached) return cached

  const pending = _inflight.get(key)
  if (pending) return pending

  const promise = (async () => {
    const resolved = await apiFetch<GetFileResponse>({
      path: "/files",
      method: "GET",
      params: { filename: key },
    })
    const dataUrl = resolved.data?.base64_url
    if (!dataUrl) throw new Error("File lookup response missing base64_url")
    _cache.set(key, dataUrl)
    _inflight.delete(key)
    return dataUrl
  })()
  _inflight.set(key, promise)
  return promise
}
