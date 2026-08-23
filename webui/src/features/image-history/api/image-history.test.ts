import { beforeEach, describe, expect, it, vi } from "vitest"


const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  useInfiniteQuery: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock("@/api", () => ({ apiFetch: mocks.apiFetch }))
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: mocks.useInfiniteQuery,
  useQuery: mocks.useQuery,
}))

import {
  fetchImageHistoryAssetBlob,
  getImageHistoryPage,
  getImageHistorySummary,
  useImageHistoryPages,
  useImageHistorySummary,
} from "./image-history"


describe("image history API", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset().mockResolvedValue({})
    mocks.useInfiniteQuery.mockReset().mockReturnValue({})
    mocks.useQuery.mockReset().mockReturnValue({})
  })


  it("uses authenticated read-only endpoints and forwards AbortSignal", async () => {
    const signal = new AbortController().signal

    await getImageHistorySummary(signal)
    await getImageHistoryPage({ userUid: "user-a", status: "failed" }, "cursor-a", signal)
    await fetchImageHistoryAssetBlob("generation-a", "asset-a", signal)

    expect(mocks.apiFetch).toHaveBeenNthCalledWith(1, {
      path: "/image-history/summary",
      signal,
    })
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(2, {
      path: "/image-history",
      params: {
        limit: 25,
        cursor: "cursor-a",
        user_uid: "user-a",
        status: "failed",
      },
      signal,
    })
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(3, {
      path: "/image-history/generation-a/assets/asset-a/content",
      responseType: "blob",
      signal,
    })
    for (const [options] of mocks.apiFetch.mock.calls) {
      expect(options.method ?? "GET").toBe("GET")
    }
  })


  it("resets the cursor chain through filter-specific query keys", async () => {
    useImageHistoryPages({ userUid: null, status: null })
    const allOptions = mocks.useInfiniteQuery.mock.calls[0][0]
    expect(allOptions.queryKey).toEqual(["imageHistory", "pages", "all", "all"])
    expect(allOptions.initialPageParam).toBeNull()

    useImageHistoryPages({ userUid: "user-b", status: "retryable" })
    const filteredOptions = mocks.useInfiniteQuery.mock.calls[1][0]
    expect(filteredOptions.queryKey).toEqual(["imageHistory", "pages", "user-b", "retryable"])
    expect(filteredOptions.initialPageParam).toBeNull()

    const signal = new AbortController().signal
    await filteredOptions.queryFn({ pageParam: "cursor-b", signal })
    expect(mocks.apiFetch).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ cursor: "cursor-b", user_uid: "user-b", status: "retryable" }),
      signal,
    }))
    expect(filteredOptions.getNextPageParam({ next_cursor: null })).toBeUndefined()
    expect(filteredOptions.getNextPageParam({ next_cursor: "next" })).toBe("next")
  })


  it("configures summary as a cancellable TanStack query", async () => {
    useImageHistorySummary()
    const options = mocks.useQuery.mock.calls[0][0]
    expect(options.queryKey).toEqual(["imageHistory", "summary"])
    const signal = new AbortController().signal
    await options.queryFn({ signal })
    expect(mocks.apiFetch).toHaveBeenCalledWith({ path: "/image-history/summary", signal })
  })
})
