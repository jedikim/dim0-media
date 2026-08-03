/**
 * Desktop-direct BYOK web search — calls the provider straight from the Tauri
 * webview (CORS-free via plugin-http), returning the same shape `/ai/search`
 * does, so the search client is unchanged. This is what lets web search work
 * fully offline-of-our-servers on desktop with the user's own key.
 *
 * Request/response shapes mirror the backend `websearch/tools.py`. An engine not
 * in `DESKTOP_SEARCH` falls back to the (online) `/ai/search` path.
 */
import { providerPostJson, type FetchFn } from "./desktop-http"
import type { SearchResult } from "./clients"


type SearchResponse = { answer: string; results: SearchResult[] }
type SearchPost = (body: { query: string; engine?: string }) => Promise<SearchResponse>

const asResults = (results: SearchResult[]): SearchResponse => ({ answer: "", results })


/** Direct Linkup search (BYOK). */
export const desktopLinkupSearch =
  (apiKey: string, fetchImpl?: FetchFn): SearchPost =>
  async (body) => {
    const res = await providerPostJson<{ results?: Array<{ url: string; name?: string; content?: string }> }>(
      "https://api.linkup.so/v1/search",
      { q: body.query, outputType: "searchResults", depth: "standard" },
      { Authorization: `Bearer ${apiKey}` },
      fetchImpl,
    )
    return asResults((res.results ?? []).map((r) => ({ url: r.url, title: r.name ?? "", content: r.content ?? "" })))
  }


/** Direct Tavily search (BYOK). */
export const desktopTavilySearch =
  (apiKey: string, fetchImpl?: FetchFn): SearchPost =>
  async (body) => {
    const res = await providerPostJson<{ results?: Array<{ url: string; title?: string; content?: string }> }>(
      "https://api.tavily.com/search",
      { query: body.query, max_results: 10, search_depth: "advanced", auto_parameters: true },
      { Authorization: `Bearer ${apiKey}` },
      fetchImpl,
    )
    return asResults((res.results ?? []).map((r) => ({ url: r.url, title: r.title ?? "", content: r.content ?? "" })))
  }


/** Direct Perplexity search (BYOK). */
export const desktopPerplexitySearch =
  (apiKey: string, fetchImpl?: FetchFn): SearchPost =>
  async (body) => {
    const res = await providerPostJson<{ results?: Array<{ url: string; title?: string; snippet?: string }> }>(
      "https://api.perplexity.ai/search",
      { query: body.query, max_results: 10, max_tokens_per_page: 1200 },
      { Authorization: `Bearer ${apiKey}` },
      fetchImpl,
    )
    return asResults((res.results ?? []).map((r) => ({ url: r.url, title: r.title ?? "", content: r.snippet ?? "" })))
  }


/** Direct Exa search (BYOK). Uses the `x-api-key` header, not a bearer token. */
export const desktopExaSearch =
  (apiKey: string, fetchImpl?: FetchFn): SearchPost =>
  async (body) => {
    const res = await providerPostJson<{
      results?: Array<{ url: string; title?: string; text?: string; summary?: string }>
    }>(
      "https://api.exa.ai/search",
      { query: body.query, type: "fast", numResults: 10, contents: { context: true } },
      { "x-api-key": apiKey },
      fetchImpl,
    )
    return asResults(
      (res.results ?? []).map((r) => ({ url: r.url, title: r.title ?? "", content: r.text ?? r.summary ?? "" })),
    )
  }


/** Ported desktop-direct BYOK search providers, keyed by engine id (byok-store `SearchEngine`). */
const DESKTOP_SEARCH: Record<string, (apiKey: string) => SearchPost> = {
  linkup: (apiKey) => desktopLinkupSearch(apiKey),
  tavily: (apiKey) => desktopTavilySearch(apiKey),
  perplexity: (apiKey) => desktopPerplexitySearch(apiKey),
  exa: (apiKey) => desktopExaSearch(apiKey),
}


/**
 * A desktop-direct `SearchPost` for the engine, or `null` if that engine isn't
 * ported (caller then keeps the online `/ai/search` path).
 */
export const desktopSearchPost = (engine: string | undefined, apiKey: string): SearchPost | null => {
  const make = engine ? DESKTOP_SEARCH[engine] : undefined
  return make ? make(apiKey) : null
}
