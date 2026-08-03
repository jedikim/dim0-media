/**
 * Desktop remote-server configuration.
 *
 * On the Tauri build there's no `__APP_CONFIG__` injection, so the remote server
 * URL (which powers sign-in → managed AI + synced boards) is baked in at build
 * via `VITE_API_URL` — there is no in-app override. `config/api.ts::API_URL`
 * reads it at module load.
 *
 * Unset ⇒ the desktop app stays purely local/offline (BYOK) — no server contact.
 */


/** Schemeless input defaults to `http` for localhost / IP / `.local` hosts (LAN
 *  self-host rarely has TLS) and `https` otherwise. */
const defaultScheme = (input: string): "http" | "https" => {
  const authority = input.split("/")[0].toLowerCase()
  // Unwrap a bracketed IPv6 literal (`[::1]:8888`) before stripping the port.
  const host = authority.startsWith("[")
    ? authority.slice(1, authority.indexOf("]"))
    : authority.split(":")[0]
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  return isLocal ? "http" : "https"
}


/**
 * The effective remote-server base: the origin baked in at build via
 * `VITE_API_URL` (from the `API_ORIGIN` release variable), or `undefined` when
 * unset or malformed (a pure local/offline build, or a misconfig that degrades to
 * the dev-backend fallback in `config/api.ts` rather than crashing). Consumed by
 * `config/api.ts` to set `API_URL`.
 *
 * Normalized to a bare origin — the app addresses the backend with absolute paths
 * (`new URL("/x", base)`), so any path in the value is dropped rather than
 * silently 404-ing every call. A missing scheme is filled in (http for
 * local/LAN hosts, https otherwise) instead of parsing as `new URL("host:port")`
 * → origin `"null"`.
 */
export const getEffectiveApiBase = (): string | undefined => {
  const raw = import.meta.env.VITE_API_URL?.trim()
  if (!raw) return undefined
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `${defaultScheme(raw)}://${raw}`
  try {
    return new URL(withScheme).origin
  } catch {
    // Genuinely malformed — degrade to the dev-backend fallback rather than hand
    // back an unusable base that would throw at every request site.
    return undefined
  }
}
