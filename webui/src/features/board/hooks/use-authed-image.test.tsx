import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const { fetchImageAssetBlob } = vi.hoisted(() => ({ fetchImageAssetBlob: vi.fn() }))

vi.mock("../api/image-generation", () => ({ fetchImageAssetBlob }))

import { useAuthedImage } from "./use-authed-image"


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
})
