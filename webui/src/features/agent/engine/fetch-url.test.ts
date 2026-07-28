import { describe, expect, it, vi } from "vitest"
import type { ToolContext } from "./types"
import { makeFetchTool, managedFetchClient, resolveFetchClient, type FetchPost } from "./fetch-url"


describe("managedFetchClient", () => {
  it("posts the url and returns the page content", async () => {
    const post = vi.fn<FetchPost>(async () => ({ url: "https://a.com", title: "A", text: "body" }))
    const page = await managedFetchClient({ post }).fetch("https://a.com")
    expect(post).toHaveBeenCalledWith({ url: "https://a.com" })
    expect(page).toEqual({ url: "https://a.com", title: "A", text: "body" })
  })

  it("maps a null title to undefined", async () => {
    const post = vi.fn<FetchPost>(async () => ({ url: "https://a.com", title: null, text: "b" }))
    expect((await managedFetchClient({ post }).fetch("https://a.com")).title).toBeUndefined()
  })
})


describe("makeFetchTool", () => {
  it("is named 'fetch' and reads the url via the client", async () => {
    const fetch = vi.fn(async () => ({ url: "https://x.com", title: "X", text: "t" }))
    const tool = makeFetchTool({ fetch })
    expect(tool.name).toBe("fetch")
    const out = await tool.run({ url: "https://x.com" }, {} as ToolContext)
    expect(fetch).toHaveBeenCalledWith("https://x.com")
    expect(out).toEqual({ url: "https://x.com", title: "X", text: "t" })
  })
})


describe("resolveFetchClient", () => {
  it("signed in → a managed client; signed out → null", () => {
    expect(resolveFetchClient({ signedIn: true })).not.toBeNull()
    expect(resolveFetchClient({ signedIn: false })).toBeNull()
  })
})
