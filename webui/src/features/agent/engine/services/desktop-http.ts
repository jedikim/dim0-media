/**
 * Desktop (Tauri) HTTP — CORS-free provider access via `@tauri-apps/plugin-http`.
 *
 * In the browser, BYOK provider calls either go direct (LLM) or through our
 * `/ai/*` proxies (search/parse, which the webview can't reach cross-origin). On
 * desktop there is no proxy for the BYOK path and the webview still enforces
 * CORS, so those calls route through the plugin's native `fetch`, which is not
 * subject to CORS. The plugin is imported lazily so the web bundle never loads it.
 */

/** A `fetch`-compatible function (the web signature; plugin-http matches it). */
export type FetchFn = typeof fetch


let pluginFetch: FetchFn | null = null


/**
 * A `fetch` that bypasses the webview's CORS (Tauri only), delegating to
 * `@tauri-apps/plugin-http`. Usable anywhere a `fetch` is accepted (e.g. the
 * OpenAI SDK's `fetch` option). Only call on desktop — see `isTauri()`.
 */
export const tauriFetch: FetchFn = async (input, init) => {
  if (!pluginFetch) {
    const mod = await import("@tauri-apps/plugin-http")
    pluginFetch = mod.fetch as unknown as FetchFn
  }
  return pluginFetch(input, init)
}


/** POST JSON to a provider and parse the JSON reply; throws on a non-2xx status. */
export const providerPostJson = async <T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  fetchImpl: FetchFn = tauriFetch,
): Promise<T> => {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`${url} failed: ${res.status}${detail ? ` - ${detail}` : ""}`)
  }
  return (await res.json()) as T
}
