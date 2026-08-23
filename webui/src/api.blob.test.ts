import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/features/connection/connection-state", () => ({ notifyHttpFailure: vi.fn() }))

import { apiFetch, registerLogoutHandler } from "./api"
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
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
    registerLogoutHandler(null)
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
    expect(getAccessToken()).toBe("fresh-access")
    expect(getRefreshToken()).toBe("fresh-refresh")
  })


  it("propagates an abort after refresh without clearing tokens or logging out", async () => {
    let finishRefresh = (response: Response): void => {
      void response
      throw new Error("Refresh request did not start")
    }
    const logout = vi.fn()
    const controller = new AbortController()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 401, statusText: "Unauthorized" }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRefresh = resolve }))
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal?.aborted).toBe(true)
        return Promise.reject(new DOMException("The operation was aborted", "AbortError"))
      })
    vi.stubGlobal("fetch", fetchMock)
    registerLogoutHandler(logout)

    const request = apiFetch<Blob>({
      path: "/image-history/generation/assets/asset/content",
      responseType: "blob",
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    controller.abort()
    finishRefresh(new Response(JSON.stringify({
      data: { token: { access_token: "fresh-access", refresh_token: "fresh-refresh" } },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))

    await expect(request).rejects.toMatchObject({ name: "AbortError" })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getAccessToken()).toBe("fresh-access")
    expect(getRefreshToken()).toBe("fresh-refresh")
    expect(logout).not.toHaveBeenCalled()
  })
})
