import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiFetch } from "./api"
import {
  clearTokens,
  setAccessToken,
  setRefreshToken,
} from "./features/signin/auth-storage"


describe("apiFetch blob response", () => {
  beforeEach(() => {
    clearTokens()
    setAccessToken("expired-access")
    setRefreshToken("refresh-token")
  })


  afterEach(() => {
    vi.unstubAllGlobals()
    clearTokens()
  })


  it("preserves blob mode across a 401 refresh retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 401, statusText: "Unauthorized" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { token: { access_token: "fresh-access", refresh_token: "fresh-refresh" } },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await apiFetch<Blob>({
      path: "/boards/board-1/image-assets/asset-1/content",
      responseType: "blob",
    })

    expect(result.size).toBe(4)
    expect(result.type).toBe("image/png")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const retry = fetchMock.mock.calls[2]?.[1] as RequestInit
    expect(new Headers(retry.headers).get("Authorization")).toBe("Bearer fresh-access")
  })
})
