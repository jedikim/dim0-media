import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL } from "@/config/api"


// The transport is the ONLY thing that touches @/api; mock the raw fetch so we
// can assert URL/headers/body and simulate status codes without a network.
const fetchWithAuthRaw = vi.hoisted(() => vi.fn())
vi.mock("@/api", () => ({ fetchWithAuthRaw }))


import { isOverQuotaError } from "./run"
import {
  getServicesBaseUrl,
  servicesPost,
  servicesStream,
  servicesUpload,
  setServicesBaseUrl,
} from "./transport"


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


const lastCall = () => fetchWithAuthRaw.mock.calls.at(-1) as [string, RequestInit & { headers: Headers }]


beforeEach(() => fetchWithAuthRaw.mockReset())
afterEach(() => setServicesBaseUrl(API_URL)) // undo any base-url swap


describe("servicesPost", () => {
  it("unwraps the { data } envelope", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ answer: "hi", results: [] }))
    const out = await servicesPost<{ answer: string; results: unknown[] }>("/ai/search", { query: "q" })
    expect(out).toEqual({ answer: "hi", results: [] })
  })

  it("POSTs to baseUrl + path with JSON content-type and the body serialized", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ ok: true }))
    await servicesPost("/ai/code", { code: "1+1", language: "python" })
    const [url, init] = lastCall()
    expect(url).toBe(`${new URL("/ai/code", getServicesBaseUrl()).toString()}`)
    expect(init.method).toBe("POST")
    expect(init.headers.get("Content-Type")).toBe("application/json")
    expect(init.body).toBe(JSON.stringify({ code: "1+1", language: "python" }))
  })

  it("merges caller headers (run id + provider key)", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({}))
    await servicesPost("/ai/search", { query: "q" }, { "X-Run-Id": "r1", "X-Provider-Key": "sk-x" })
    const [, init] = lastCall()
    expect(init.headers.get("X-Run-Id")).toBe("r1")
    expect(init.headers.get("X-Provider-Key")).toBe("sk-x")
  })

  it("throws an error whose message keeps 429 as a token (isOverQuotaError contract)", async () => {
    fetchWithAuthRaw.mockResolvedValue(errorResponse(429))
    const err = await servicesPost("/ai/search", {}).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isOverQuotaError(err)).toBe(true)
  })

  it("throws on other non-2xx without matching the over-quota signal", async () => {
    fetchWithAuthRaw.mockResolvedValue(errorResponse(500))
    const err = await servicesPost("/ai/search", {}).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isOverQuotaError(err)).toBe(false)
  })

  it("folds the server's error body into the thrown message", async () => {
    fetchWithAuthRaw.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Unsupported search engine 'foo'",
    } as unknown as Response)
    const err = (await servicesPost("/ai/search", {}).catch((e) => e)) as Error
    expect(err.message).toContain("400")
    expect(err.message).toContain("Unsupported search engine")
  })

  it("routes through a swapped base URL (the desktop seam)", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({}))
    setServicesBaseUrl("http://localhost:9999")
    await servicesPost("/ai/fetch", { url: "https://x.com" })
    const [url] = lastCall()
    expect(url).toBe("http://localhost:9999/ai/fetch")
  })
})


describe("servicesUpload", () => {
  it("sends the FormData as-is and does NOT set Content-Type (browser owns the boundary)", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ markdown: "# x", pages: 1 }))
    const form = new FormData()
    form.append("file", new Blob(["%PDF"], { type: "application/pdf" }), "doc.pdf")
    const out = await servicesUpload<{ markdown: string; pages: number }>("/ai/parse", form, { "X-Run-Id": "r1" })
    expect(out).toEqual({ markdown: "# x", pages: 1 })
    const [, init] = lastCall()
    expect(init.body).toBe(form)
    expect(init.headers.get("Content-Type")).toBeNull()
    expect(init.headers.get("X-Run-Id")).toBe("r1")
  })

  it("throws a 429-detectable error on over-quota", async () => {
    fetchWithAuthRaw.mockResolvedValue(errorResponse(429))
    const err = await servicesUpload("/ai/parse", new FormData()).catch((e) => e)
    expect(isOverQuotaError(err)).toBe(true)
  })
})


describe("servicesStream", () => {
  const drain = async <T,>(it: AsyncIterable<T>): Promise<T[]> => {
    const out: T[] = []
    for await (const x of it) out.push(x)
    return out
  }

  it("yields the NDJSON frames in order", async () => {
    fetchWithAuthRaw.mockResolvedValue(
      streamResponse([{ type: "delta", text: "a" }, { type: "delta", text: "b" }, { type: "final" }]),
    )
    const frames = await drain(servicesStream("/ai/llm/stream", { model: "auto" }))
    expect(frames).toEqual([{ type: "delta", text: "a" }, { type: "delta", text: "b" }, { type: "final" }])
  })

  it("throws (429-detectable) before streaming when the response is not ok", async () => {
    fetchWithAuthRaw.mockResolvedValue(errorResponse(429))
    const err = await drain(servicesStream("/ai/llm/stream", {})).catch((e) => e)
    expect(isOverQuotaError(err)).toBe(true)
  })
})
