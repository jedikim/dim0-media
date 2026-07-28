import { afterEach, describe, expect, it, vi } from "vitest"


// The default transports for search/code go through the shared services
// transport (→ fetchWithAuthRaw). Mock it to drive the "over quota (429) → retry
// with the user's key" fallback. A 429 is a non-ok Response, not a throw.
const fetchWithAuthRaw = vi.hoisted(() => vi.fn())
vi.mock("@/api", () => ({ fetchWithAuthRaw }))

import { managedSearchClient } from "./web-search"
import { managedCodeClient } from "./code-interpreter"


const jsonResponse = <T,>(data: T): Response =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as unknown as Response


const errorResponse = (status: number): Response =>
  ({ ok: false, status, text: async () => "" }) as unknown as Response


const providerKeyOf = (callIndex: number): string | null => {
  const init = fetchWithAuthRaw.mock.calls[callIndex]?.[1] as { headers: Headers } | undefined
  return init ? init.headers.get("X-Provider-Key") : null
}


afterEach(() => vi.clearAllMocks())


describe("search BYOK fallback on 429", () => {
  it("retries with X-Provider-Key when the managed call is over quota", async () => {
    fetchWithAuthRaw
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(jsonResponse({ answer: "", results: [{ url: "https://a.com", title: "A", content: "b" }] }))

    const results = await managedSearchClient({ runId: "r1", engine: "exa", byokKey: "exa-user" }).search("cats")

    expect(fetchWithAuthRaw).toHaveBeenCalledTimes(2)
    expect(providerKeyOf(0)).toBeNull() // 1st call: our keys
    expect(providerKeyOf(1)).toBe("exa-user") // retry: user's key
    expect(results[0].url).toBe("https://a.com")
  })

  it("does not retry (and rethrows) when there's no BYOK key", async () => {
    fetchWithAuthRaw.mockResolvedValue(errorResponse(429))
    await expect(managedSearchClient({ runId: "r1" }).search("cats")).rejects.toThrow("429")
    expect(fetchWithAuthRaw).toHaveBeenCalledTimes(1)
  })

  it("does not retry on a non-429 error", async () => {
    fetchWithAuthRaw.mockResolvedValue(errorResponse(500))
    await expect(managedSearchClient({ byokKey: "exa-user" }).search("cats")).rejects.toThrow("500")
    expect(fetchWithAuthRaw).toHaveBeenCalledTimes(1)
  })
})


describe("code BYOK fallback on 429", () => {
  it("retries the run with X-Provider-Key when over quota", async () => {
    fetchWithAuthRaw
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(jsonResponse({ status: "success", stdout: "ok", stderr: "", duration_ms: 3 }))

    const r = await managedCodeClient({ runId: "r1", byokKey: "dtn-user" }).run("print(1)", "python")

    expect(fetchWithAuthRaw).toHaveBeenCalledTimes(2)
    expect(providerKeyOf(1)).toBe("dtn-user")
    expect(r.ok).toBe(true)
  })
})
