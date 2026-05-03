import type { Page, PageProvider } from "./types"


/**
 * Module-level cache so multiple chips referencing the same page resolve
 * once. Stores `null` for pages that came back missing/forbidden so we
 * don't refetch on every render. Listeners are fired when an entry
 * resolves, letting React subscribers re-render without prop drilling.
 */
const _cache = new Map<string, Page | null>()
const _inflight = new Map<string, Promise<Page | null>>()
const _listeners = new Map<string, Set<() => void>>()


function notify(id: string): void {
  const set = _listeners.get(id)
  if (!set) return
  set.forEach((fn) => fn())
}


/** True when an entry is in the cache (resolved or known-missing). */
export function hasCachedPage(id: string): boolean {
  return _cache.has(id)
}


/** Synchronous read; null if the page is known-missing, undefined if unknown. */
export function readCachedPage(id: string): Page | null | undefined {
  return _cache.has(id) ? _cache.get(id) : undefined
}


/** Pre-fill the cache (used after a fresh @mention insert). */
export function primePageCache(page: Page): void {
  _cache.set(page.id, page)
  notify(page.id)
}


/** Manually drop an entry — call when the caller knows the title changed. */
export function invalidatePage(id: string): void {
  _cache.delete(id)
  _inflight.delete(id)
  notify(id)
}


/**
 * Resolve a page through the provider, deduplicating concurrent calls and
 * caching the result. The result is also `null` for missing/forbidden pages
 * so callers can render a deleted-state without retry-looping.
 */
export function resolvePage(
  provider: PageProvider,
  id: string,
): Promise<Page | null> {
  if (_cache.has(id)) return Promise.resolve(_cache.get(id) ?? null)

  const pending = _inflight.get(id)
  if (pending) return pending

  const promise = (async () => {
    try {
      const page = await provider.get(id)
      _cache.set(id, page ?? null)
      _inflight.delete(id)
      notify(id)
      return page ?? null
    } catch (err) {
      console.error("[page-cache] get failed", id, err)
      _inflight.delete(id)
      // Don't poison the cache on transient errors; let the next caller retry.
      return null
    }
  })()
  _inflight.set(id, promise)
  return promise
}


/** Subscribe to cache updates for a single page id. */
export function subscribePage(id: string, fn: () => void): () => void {
  let set = _listeners.get(id)
  if (!set) {
    set = new Set()
    _listeners.set(id, set)
  }
  set.add(fn)
  return () => {
    set?.delete(fn)
    if (set && set.size === 0) _listeners.delete(id)
  }
}
