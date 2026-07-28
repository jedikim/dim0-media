import { beforeEach, describe, expect, it, vi } from "vitest"


// Exercise each managed client's DEFAULT transport path (no injected post) end
// to end: client → makeDefault*Post → servicesPost/Stream → fetchWithAuthRaw.
const fetchWithAuthRaw = vi.hoisted(() => vi.fn())
vi.mock("@/api", () => ({ fetchWithAuthRaw }))


import { managedSearchClient } from "../web-search"
import { managedCodeClient } from "../code-interpreter"
import { managedFetchClient } from "../fetch-url"
import { managedLlmClient } from "../managed-client"
import type { LlmMessage, LlmStreamEvent } from "../types"


const jsonResponse = <T,>(data: T): Response =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as unknown as Response


const errorResponse = (status: number): Response =>
  ({ ok: false, status, text: async () => "" }) as unknown as Response


const streamResponse = (lines: unknown[]): Response => {
  const ndjson = lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(ndjson))
      c.close()
    },
  })
  return { ok: true, status: 200, body } as unknown as Response
}


const headersOf = (callIndex: number): Headers =>
  (fetchWithAuthRaw.mock.calls[callIndex][1] as { headers: Headers }).headers


const urlOf = (callIndex: number): string => fetchWithAuthRaw.mock.calls[callIndex][0] as string


beforeEach(() => fetchWithAuthRaw.mockReset())


describe("managedSearchClient (default transport)", () => {
  it("hits /ai/search with the run id and no provider key on the managed happy path", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ answer: "", results: [{ url: "https://a.com" }] }))
    const results = await managedSearchClient({ runId: "run-1" }).search("cats")
    expect(results).toEqual([{ url: "https://a.com" }])
    expect(urlOf(0)).toMatch(/\/ai\/search$/)
    expect(headersOf(0).get("X-Run-Id")).toBe("run-1")
    expect(headersOf(0).get("X-Provider-Key")).toBeNull()
    expect(fetchWithAuthRaw).toHaveBeenCalledOnce()
  })

  it("falls back to the BYOK key on a 429 (our-keys-first, yours-as-fallback)", async () => {
    fetchWithAuthRaw
      .mockResolvedValueOnce(errorResponse(429)) // managed → over quota
      .mockResolvedValueOnce(jsonResponse({ answer: "", results: [{ url: "https://b.com" }] })) // retry w/ key
    const results = await managedSearchClient({ byokKey: "exa-key", engine: "exa" }).search("dogs")
    expect(results).toEqual([{ url: "https://b.com" }])
    expect(fetchWithAuthRaw).toHaveBeenCalledTimes(2)
    expect(headersOf(0).get("X-Provider-Key")).toBeNull() // first: our keys
    expect(headersOf(1).get("X-Provider-Key")).toBe("exa-key") // retry: relayed key
  })

  it("sends the BYOK key up front in byok mode (alwaysByok)", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ answer: "", results: [] }))
    await managedSearchClient({ byokKey: "exa-key", alwaysByok: true }).search("q")
    expect(fetchWithAuthRaw).toHaveBeenCalledOnce()
    expect(headersOf(0).get("X-Provider-Key")).toBe("exa-key")
  })

  it("propagates a non-429 error without retrying", async () => {
    fetchWithAuthRaw.mockResolvedValue(errorResponse(500))
    await expect(managedSearchClient({ byokKey: "exa-key" }).search("q")).rejects.toThrow()
    expect(fetchWithAuthRaw).toHaveBeenCalledOnce() // no fallback on 500
  })
})


describe("managedCodeClient (default transport)", () => {
  it("maps a successful /ai/code response to a CodeResult", async () => {
    fetchWithAuthRaw.mockResolvedValue(
      jsonResponse({ status: "success", stdout: "2", stderr: "", duration_ms: 5 }),
    )
    const r = await managedCodeClient({ runId: "r" }).run("print(1+1)", "python")
    expect(r).toEqual({ ok: true, stdout: "2", stderr: "", error: undefined })
    expect(urlOf(0)).toMatch(/\/ai\/code$/)
  })

  it("falls back to the BYOK Daytona key on 429", async () => {
    fetchWithAuthRaw
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(jsonResponse({ status: "success", stdout: "ok", stderr: "", duration_ms: 1 }))
    const r = await managedCodeClient({ byokKey: "dt-key" }).run("x", "python")
    expect(r.ok).toBe(true)
    expect(headersOf(1).get("X-Provider-Key")).toBe("dt-key")
  })
})


describe("managedFetchClient (default transport)", () => {
  it("maps /ai/fetch to a PageContent", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ url: "https://x.com", title: "X", text: "body" }))
    const page = await managedFetchClient({ runId: "r" }).fetch("https://x.com")
    expect(page).toEqual({ url: "https://x.com", title: "X", text: "body" })
    expect(urlOf(0)).toMatch(/\/ai\/fetch$/)
  })
})


describe("managedLlmClient (default transport)", () => {
  const messages: LlmMessage[] = [{ role: "user", content: "hi" }]

  const drain = async (it: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> => {
    const out: LlmStreamEvent[] = []
    for await (const ev of it) out.push(ev)
    return out
  }

  it("posts a non-stream turn to /ai/llm and maps the choice", async () => {
    fetchWithAuthRaw.mockResolvedValue(
      jsonResponse({ choices: [{ message: { role: "assistant", content: "the answer" } }] }),
    )
    const turn = await managedLlmClient("auto", { runId: "r" }).complete(messages, [])
    expect(turn).toEqual({ kind: "text", text: "the answer" })
    expect(urlOf(0)).toMatch(/\/ai\/llm$/)
  })

  it("streams /ai/llm/stream NDJSON into mapped events", async () => {
    fetchWithAuthRaw.mockResolvedValue(
      streamResponse([
        { type: "delta", text: "He" },
        { type: "delta", text: "llo" },
        { type: "final", message: { role: "assistant", content: "Hello", refusal: null } },
      ]),
    )
    const events = await drain(managedLlmClient("auto", { runId: "r" }).completeStream!(messages, []))
    expect(events).toEqual([
      { kind: "delta", text: "He" },
      { kind: "delta", text: "llo" },
      { kind: "final", turn: { kind: "text", text: "Hello" } },
    ])
    expect(urlOf(0)).toMatch(/\/ai\/llm\/stream$/)
  })
})
