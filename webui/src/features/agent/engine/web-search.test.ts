import { describe, expect, it, vi } from "vitest"
import type { SearchClient } from "./services/clients"
import type { AgentEvent, ToolContext } from "./types"
import { collectSourceUrls, makeWebSearchTool, managedSearchClient, resolveSearchClient, type SearchPost } from "./web-search"


const response = (results: { url: string; title?: string; content?: string }[]) => ({ answer: "", results })


describe("managedSearchClient", () => {
  it("posts the query and returns the results", async () => {
    const post = vi.fn<SearchPost>(async () => response([{ url: "https://a.com", title: "A", content: "…" }]))
    const results = await managedSearchClient({ post }).search("cats")
    expect(post).toHaveBeenCalledWith({ query: "cats" })
    expect(results).toEqual([{ url: "https://a.com", title: "A", content: "…" }])
  })

  it("includes the engine when configured", async () => {
    const post = vi.fn<SearchPost>(async () => response([]))
    await managedSearchClient({ post, engine: "tavily" }).search("q")
    expect(post).toHaveBeenCalledWith({ query: "q", engine: "tavily" })
  })
})


describe("makeWebSearchTool", () => {
  it("runs the search and returns url/title/content per source", async () => {
    const client: SearchClient = {
      search: async () => [{ url: "https://x.com", title: "X", content: "body", snippet: "s" }],
    }
    const tool = makeWebSearchTool(client)
    expect(tool.name).toBe("web_search")
    const out = (await tool.run({ query: "hi" }, {} as ToolContext)) as { results: unknown[] }
    expect(out.results).toEqual([{ url: "https://x.com", title: "X", content: "body" }])
  })
})


describe("resolveSearchClient", () => {
  it("signed in → a managed client", () => {
    expect(resolveSearchClient({ signedIn: true })).not.toBeNull()
  })

  it("signed out → null (no BYOK web search from the browser)", () => {
    expect(resolveSearchClient({ signedIn: false })).toBeNull()
  })
})


describe("collectSourceUrls", () => {
  it("collects web_search AND fetch URLs, deduped and in order; ignores other events", () => {
    const events: AgentEvent[] = [
      { type: "tool_start", toolName: "web_search", args: {} },
      { type: "tool_result", toolName: "web_search", result: { results: [{ url: "https://a.com" }, { url: "https://b.com" }] } },
      { type: "tool_result", toolName: "create_note", result: { id: "n1" } },
      { type: "tool_result", toolName: "fetch", result: { url: "https://b.com", title: "B", text: "…" } }, // deduped
      { type: "tool_result", toolName: "fetch", result: { url: "https://d.com", title: "D", text: "…" } },
      { type: "tool_result", toolName: "web_search", result: { results: [{ url: "https://c.com" }] } },
      { type: "assistant_text", text: "done" },
    ]
    expect(collectSourceUrls(events)).toEqual(["https://a.com", "https://b.com", "https://d.com", "https://c.com"])
  })

  it("returns [] when there were no search/fetch results", () => {
    expect(collectSourceUrls([{ type: "assistant_text", text: "hi" }, { type: "done" }])).toEqual([])
  })
})
