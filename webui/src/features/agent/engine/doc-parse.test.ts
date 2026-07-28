import { beforeEach, describe, expect, it, vi } from "vitest"


// Default path goes through the services transport → fetchWithAuthRaw; mock it.
const fetchWithAuthRaw = vi.hoisted(() => vi.fn())
vi.mock("@/api", () => ({ fetchWithAuthRaw }))


import { managedParseClient, resolveParseClient, type ParsePost } from "./doc-parse"


const jsonResponse = <T,>(data: T): Response =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as unknown as Response


const errorResponse = (status: number): Response =>
  ({ ok: false, status, text: async () => "" }) as unknown as Response


const providerKeyOf = (callIndex: number): string | null => {
  const init = fetchWithAuthRaw.mock.calls[callIndex]?.[1] as { headers: Headers } | undefined
  return init ? init.headers.get("X-Provider-Key") : null
}


const pdf = (): File => new File(["%PDF-1.4"], "doc.pdf", { type: "application/pdf" })


beforeEach(() => fetchWithAuthRaw.mockReset())


describe("managedParseClient", () => {
  it("returns the parsed markdown + page count from an injected post", async () => {
    const post = vi.fn<ParsePost>(async () => ({ markdown: "# Title\n\nbody", pages: 2 }))
    const out = await managedParseClient({ post }).parse(pdf())
    expect(out).toEqual({ markdown: "# Title\n\nbody", pages: 2 })
  })

  it("hits /ai/parse with the run id and no provider key on the managed happy path", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ markdown: "x", pages: 1 }))
    await managedParseClient({ runId: "run-1" }).parse(pdf())
    expect(fetchWithAuthRaw.mock.calls[0][0]).toMatch(/\/ai\/parse$/)
    const init = fetchWithAuthRaw.mock.calls[0][1] as { headers: Headers; body: unknown }
    expect(init.headers.get("X-Run-Id")).toBe("run-1")
    expect(providerKeyOf(0)).toBeNull()
    expect(init.body).toBeInstanceOf(FormData)
  })

  it("falls back to the BYOK Mistral key on a 429", async () => {
    fetchWithAuthRaw
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(jsonResponse({ markdown: "y", pages: 1 }))
    const out = await managedParseClient({ byokKey: "mistral-key" }).parse(pdf())
    expect(out.markdown).toBe("y")
    expect(fetchWithAuthRaw).toHaveBeenCalledTimes(2)
    expect(providerKeyOf(0)).toBeNull()
    expect(providerKeyOf(1)).toBe("mistral-key")
  })

  it("sends the BYOK key up front in byok mode (alwaysByok)", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ markdown: "z", pages: 1 }))
    await managedParseClient({ byokKey: "mistral-key", alwaysByok: true }).parse(pdf())
    expect(fetchWithAuthRaw).toHaveBeenCalledOnce()
    expect(providerKeyOf(0)).toBe("mistral-key")
  })

  it("does not retry on a non-429 error", async () => {
    fetchWithAuthRaw.mockResolvedValue(errorResponse(500))
    await expect(managedParseClient({ byokKey: "mistral-key" }).parse(pdf())).rejects.toThrow()
    expect(fetchWithAuthRaw).toHaveBeenCalledOnce()
  })
})


describe("resolveParseClient (drives the upload grey-out)", () => {
  it("signed out with no key → null (off → upload greyed)", () => {
    expect(resolveParseClient({ signedIn: false })).toBeNull()
  })

  it("signed out WITH a BYOK Mistral key → a client (relayed)", () => {
    expect(resolveParseClient({ signedIn: false, byokKey: "mistral-key" })).not.toBeNull()
  })

  it("signed in → a client (managed, our key)", () => {
    expect(resolveParseClient({ signedIn: true })).not.toBeNull()
  })
})
