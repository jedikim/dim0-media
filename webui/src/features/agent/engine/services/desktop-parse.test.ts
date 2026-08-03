import { describe, expect, it } from "vitest"
import { desktopMistralParse } from "./desktop-parse"


describe("desktopMistralParse", () => {
  it("posts the PDF as a base64 data-URI with the BYOK key and joins page markdown", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, init })
      return new Response(
        JSON.stringify({ pages: [{ index: 0, markdown: "# One" }, { index: 1, markdown: "Two" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as typeof fetch

    const file = new File([new Uint8Array([1, 2, 3, 4])], "doc.pdf", { type: "application/pdf" })
    const res = await desktopMistralParse("sk-mistral", fakeFetch)(file)

    expect(res).toEqual({ markdown: "# One\n\nTwo", pages: 2 })
    expect(calls[0].url).toBe("https://api.mistral.ai/v1/ocr")
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer sk-mistral")
    const body = JSON.parse(calls[0].init?.body as string)
    expect(body.model).toBe("mistral-ocr-latest")
    expect(body.document.type).toBe("document_url")
    expect(body.document.document_url).toMatch(/^data:application\/pdf;base64,/)
  })

  it("throws with the provider status on a non-2xx reply", async () => {
    const fakeFetch = (async () => new Response("bad key", { status: 401 })) as typeof fetch
    const file = new File([new Uint8Array([0])], "doc.pdf", { type: "application/pdf" })
    await expect(desktopMistralParse("bad", fakeFetch)(file)).rejects.toThrow(/401/)
  })
})
