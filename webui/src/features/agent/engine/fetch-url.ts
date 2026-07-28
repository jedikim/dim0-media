/**
 * Fetch as a service (G3) — a managed `FetchClient` + the `fetch` agent tool +
 * resolution. Reads one URL's content via `/ai/fetch` (our keys). Managed-only
 * (browser CORS + no key relay), like the other non-LLM services.
 */
import { z } from "zod"
import { defineTool, type Tool } from "./types"
import type { FetchClient, PageContent } from "./services/clients"
import { resolveService } from "./services/resolve"
import { runIdHeaders } from "./services/run"
import { servicesPost } from "./services/transport"


type FetchResponse = { url: string; title: string | null; text: string }


/** POST a URL to `/ai/fetch`. Injectable for tests. */
export type FetchPost = (body: { url: string }) => Promise<FetchResponse>


const makeDefaultFetchPost = (runId?: string): FetchPost => async (body) =>
  servicesPost<FetchResponse>("/ai/fetch", body, runIdHeaders(runId))


/** Managed fetch client — reads a page via the `/ai/fetch` proxy. */
export const managedFetchClient = (opts: { runId?: string; post?: FetchPost } = {}): FetchClient => {
  const post = opts.post ?? makeDefaultFetchPost(opts.runId)
  return {
    async fetch(url: string): Promise<PageContent> {
      const r = await post({ url })
      return { url: r.url, title: r.title ?? undefined, text: r.text }
    },
  }
}


/** Resolve the fetch service to a client, or null when unavailable. */
export const resolveFetchClient = (opts: { signedIn: boolean; runId?: string }): FetchClient | null => {
  const resolution = resolveService("fetch", { signedIn: opts.signedIn, byok: {} })
  return resolution.mode === "managed" ? managedFetchClient({ runId: opts.runId }) : null
}


/** The `fetch` agent tool, backed by a resolved fetch client. */
export const makeFetchTool = (client: FetchClient): Tool =>
  defineTool({
    name: "fetch",
    description: "Fetch and read the content of a specific web page by URL.",
    parameters: z.object({ url: z.string().describe("The URL to read") }),
    run: async ({ url }) => client.fetch(url),
  })
