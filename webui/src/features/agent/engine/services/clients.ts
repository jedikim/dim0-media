/**
 * Service client interfaces + the LLM client factory (G1).
 *
 * `LlmClient` already exists (the agent loop's seam). The other kinds get their
 * interfaces here now so the abstraction is complete; their BYOK/managed impls
 * land in G3. `llmClientFromResolution` turns a resolution into a live client:
 * BYOK is constructible today; managed is injected (built in G2), so this stays
 * behavior-neutral until then.
 */
import type { LlmClient } from "../types"
import { ByokLlmClient, type ByokProvider } from "../byok-client"
import type { ServiceResolution } from "./kinds"
import { isTauri } from "@/platform"
import { tauriFetch } from "./desktop-http"


// ── forward-declared shapes for the non-LLM services ──
export type SearchResult = { url: string; title?: string; snippet?: string; content?: string }
export type CodeResult = { ok: boolean; stdout?: string; stderr?: string; error?: string }
export type PageContent = { url: string; title?: string; text: string }


export interface SearchClient {
  search(query: string): Promise<SearchResult[]>
}


export interface CodeClient {
  run(code: string, language: string): Promise<CodeResult>
}


export interface FetchClient {
  fetch(url: string): Promise<PageContent>
}


/** Build a managed LLM client from a managed resolution (supplied by G2). */
export type MakeManagedLlm = (
  resolution: Extract<ServiceResolution, { mode: "managed" }>,
) => LlmClient


/**
 * Construct the LLM client for a resolution, or `null` when unavailable.
 * - byok    → a direct provider client (the user's key),
 * - managed → delegated to `makeManaged` (G2); `null` until that's wired,
 * - off     → `null`.
 */
export const llmClientFromResolution = (
  resolution: ServiceResolution,
  makeManaged?: MakeManagedLlm,
): LlmClient | null => {
  if (resolution.kind !== "llm") return null
  if (resolution.mode === "byok") {
    const { provider, apiKey, model } = resolution.credential
    return ByokLlmClient.fromConfig({
      provider: provider as ByokProvider,
      apiKey,
      model: model ?? "",
      // On desktop the webview enforces CORS; route the provider call through the
      // Tauri fetch so BYOK LLM (incl. streaming) works. No-op in the browser.
      ...(isTauri() ? { fetch: tauriFetch } : {}),
    })
  }
  if (resolution.mode === "managed") {
    return makeManaged ? makeManaged(resolution) : null
  }
  return null
}
