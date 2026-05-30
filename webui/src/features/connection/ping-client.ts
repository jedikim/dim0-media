import { API_URL } from "@/config/api"


/**
 * Cheap liveness probe — hits the unauthenticated `/utils/ping` endpoint
 * and resolves `true` on 204 within `timeoutMs`. Any other outcome
 * (timeout, network error, non-2xx) resolves `false`.
 *
 * Used by the connection-state detector; deliberately not routed through
 * `apiFetch` so an in-flight 401 refresh storm can't cascade into the
 * probe.
 */
export const pingServer = async (timeoutMs = 4000): Promise<boolean> => {
  const url = new URL("/utils/ping", API_URL).toString()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, cache: "no-store" })
    return res.status === 204 || res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
