import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const { fetchImageHistoryAssetBlob } = vi.hoisted(() => ({ fetchImageHistoryAssetBlob: vi.fn() }))

vi.mock("../api/image-history", () => ({ fetchImageHistoryAssetBlob }))

import { useHistoryImage } from "./use-history-image"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true


describe("useHistoryImage", () => {
  let container: HTMLDivElement
  let root: Root
  let latest: ReturnType<typeof useHistoryImage> | null
  const createObjectURL = vi.fn()
  const revokeObjectURL = vi.fn()


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    latest = null
    fetchImageHistoryAssetBlob.mockReset()
    createObjectURL.mockReset().mockReturnValue("blob:history")
    revokeObjectURL.mockReset()
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL })
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
  })


  const render = (generationUid: string | null, assetUid: string | null, enabled: boolean): void => {
    const Probe = (): null => {
      const value = useHistoryImage(generationUid, assetUid, enabled)
      useEffect(() => { latest = value }, [value])
      return null
    }
    act(() => root.render(<Probe />))
  }


  it("waits for viewport enablement before authenticated Blob GET", async () => {
    fetchImageHistoryAssetBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }))
    render("generation-a", "asset-a", false)
    expect(fetchImageHistoryAssetBlob).not.toHaveBeenCalled()

    render("generation-a", "asset-a", true)
    await act(async () => { await Promise.resolve() })
    expect(fetchImageHistoryAssetBlob).toHaveBeenCalledWith("generation-a", "asset-a", expect.any(AbortSignal))
    expect(latest).toEqual({ url: "blob:history", failed: false })
  })


  it("aborts stale requests and revokes object URLs on replacement", async () => {
    let firstSignal: AbortSignal | undefined
    fetchImageHistoryAssetBlob.mockImplementation((_generationUid, assetUid, signal) => {
      if (assetUid === "asset-a") {
        firstSignal = signal
        return new Promise<Blob>(() => undefined)
      }
      return Promise.resolve(new Blob(["next"], { type: "image/png" }))
    })
    render("generation-a", "asset-a", true)
    render("generation-a", "asset-b", true)
    await act(async () => { await Promise.resolve() })
    expect(firstSignal?.aborted).toBe(true)
    expect(latest?.url).toBe("blob:history")
    act(() => root.unmount())
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:history")
  })


  it("shows a safe failure state for determinate content errors", async () => {
    fetchImageHistoryAssetBlob.mockRejectedValue(new Error("404 - unavailable"))
    render("generation-a", "asset-a", true)
    await act(async () => { await Promise.resolve() })
    expect(fetchImageHistoryAssetBlob).toHaveBeenCalledTimes(1)
    expect(latest).toEqual({ url: null, failed: true })
  })
})
