/**
 * Request durable (non-evictable) local storage. Best-effort + idempotent:
 * without it, the browser may wipe IndexedDB under disk pressure — data loss
 * for a local-first board. Returns whether storage is persistent.
 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
