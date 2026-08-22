import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const { fetchImageAssetBlob } = vi.hoisted(() => ({ fetchImageAssetBlob: vi.fn() }))

vi.mock("../api/image-generation", () => ({
  fetchImageAssetBlob,
  imageGenerationStatusCode: (error: unknown) => {
    const match = error instanceof Error ? /^(\d{3})\b/.exec(error.message) : null
    return match ? Number(match[1]) : null
  },
}))

import {
  AUTHED_IMAGE_TOTAL_DEADLINE_MS,
  useAuthedImage,
} from "./use-authed-image"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true


type Result = ReturnType<typeof useAuthedImage>


describe("useAuthedImage", () => {
  let container: HTMLDivElement
  let root: Root
  let latest: Result | null
  const createObjectURL = vi.fn()
  const revokeObjectURL = vi.fn()


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    latest = null
    fetchImageAssetBlob.mockReset()
    createObjectURL.mockReset()
    revokeObjectURL.mockReset()
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL })
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
    vi.useRealTimers()
  })


  const render = (graphId: string | null, assetUid: string | null): void => {
    const Probe = (): null => {
      const value = useAuthedImage(graphId, assetUid)
      useEffect(() => {
        latest = value
      }, [value])
      return null
    }
    act(() => root.render(<Probe />))
  }


  it("creates and revokes object URLs on asset replacement and unmount", async () => {
    createObjectURL.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second")
    fetchImageAssetBlob
      .mockResolvedValueOnce(new Blob(["first"], { type: "image/png" }))
      .mockResolvedValueOnce(new Blob(["second"], { type: "image/png" }))

    render("board-1", "asset-1")
    await act(async () => { await Promise.resolve() })
    expect(latest?.url).toBe("blob:first")

    render("board-1", "asset-2")
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first")
    await act(async () => { await Promise.resolve() })
    expect(latest?.url).toBe("blob:second")

    act(() => root.unmount())
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second")
  })


  it("makes no request without both board and asset identifiers", () => {
    render(null, null)
    expect(fetchImageAssetBlob).not.toHaveBeenCalled()
    expect(latest).toEqual({ url: null, failed: false })
  })


  it("retries transient transport failures and stops after success", async () => {
    vi.useFakeTimers()
    createObjectURL.mockReturnValue("blob:retried")
    fetchImageAssetBlob
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Blob(["ok"], { type: "image/png" }))

    render("board-1", "asset-1")
    await act(async () => { await Promise.resolve() })
    expect(fetchImageAssetBlob).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(fetchImageAssetBlob).toHaveBeenCalledTimes(2)
    expect(latest).toEqual({ url: "blob:retried", failed: false })
  })


  it("does not retry determinate 4xx failures", async () => {
    fetchImageAssetBlob.mockRejectedValue(new Error("404 - unavailable"))

    render("board-1", "asset-1")
    await act(async () => { await Promise.resolve() })

    expect(fetchImageAssetBlob).toHaveBeenCalledTimes(1)
    expect(latest).toEqual({ url: null, failed: true })
  })


  it("exhausts at three transient attempts", async () => {
    vi.useFakeTimers()
    fetchImageAssetBlob.mockRejectedValue(new Error("503 - unavailable"))

    render("board-1", "asset-1")
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(fetchImageAssetBlob).toHaveBeenCalledTimes(3)
    expect(latest).toEqual({ url: null, failed: true })
  })


  it("fails and aborts never-settling blob requests within the total deadline", async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    fetchImageAssetBlob.mockImplementation((_graphId, _assetUid, signal) => {
      signals.push(signal)
      return new Promise(() => undefined)
    })

    render("board-1", "asset-hanging")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTHED_IMAGE_TOTAL_DEADLINE_MS)
    })

    expect(fetchImageAssetBlob).toHaveBeenCalledTimes(3)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(latest).toEqual({ url: null, failed: true })
  })


  it("aborts an old asset and ignores its late response", async () => {
    let resolveFirst: ((blob: Blob) => void) | null = null
    let firstSignal: AbortSignal | undefined
    fetchImageAssetBlob.mockImplementation((_graphId, assetUid, signal) => {
      if (assetUid === "asset-1") {
        firstSignal = signal
        return new Promise<Blob>((resolve) => { resolveFirst = resolve })
      }
      return Promise.resolve(new Blob(["second"], { type: "image/png" }))
    })
    createObjectURL.mockReturnValue("blob:second")

    render("board-1", "asset-1")
    render("board-1", "asset-2")
    await act(async () => { await Promise.resolve() })
    expect(firstSignal?.aborted).toBe(true)
    expect(latest?.url).toBe("blob:second")

    await act(async () => {
      resolveFirst?.(new Blob(["late"], { type: "image/png" }))
      await Promise.resolve()
    })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(latest?.url).toBe("blob:second")
  })
})
