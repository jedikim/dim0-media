import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const mocks = vi.hoisted(() => ({
  node: null as Record<string, unknown> | null,
  useAuthedImage: vi.fn(),
  fetchImageAssetBlob: vi.fn(),
  getImageGenerationDetails: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@canvas-harness/react", () => ({
  useNode: () => mocks.node,
}))

vi.mock("@/features/board/hooks/use-authed-image", () => ({
  useAuthedImage: mocks.useAuthedImage,
}))

vi.mock("@/features/board/api/image-generation", () => ({
  fetchImageAssetBlob: mocks.fetchImageAssetBlob,
  getImageGenerationDetails: mocks.getImageGenerationDetails,
}))

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }))

import { GeneratedImageView } from "./view"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true


describe("GeneratedImageView", () => {
  let container: HTMLDivElement
  let root: Root
  const createObjectURL = vi.fn()
  const revokeObjectURL = vi.fn()


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.useAuthedImage.mockReset().mockReturnValue({ url: null, failed: false })
    mocks.fetchImageAssetBlob.mockReset()
    mocks.getImageGenerationDetails.mockReset()
    mocks.toastError.mockReset()
    createObjectURL.mockReset().mockReturnValue("blob:download")
    revokeObjectURL.mockReset()
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL })
    mocks.node = {
      id: "result-1",
      data: {
        graphUid: "board-1",
        properties: {
          generatedImageMarker: { type: "keyword", value: "immutable-result" },
          imageAssetUid: { type: "keyword", value: "a".repeat(32) },
          generatedImageGenerationUid: { type: "keyword", value: "g".repeat(32) },
          generatedImageGeneratorNodeUid: { type: "keyword", value: "n".repeat(32) },
        },
      },
    }
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
  })


  const render = (): void => {
    act(() => root.render(<GeneratedImageView id={"result-1" as never} />))
  }


  it("loads only its immutable board asset through the authenticated hook", () => {
    render()

    expect(mocks.useAuthedImage).toHaveBeenCalledWith("board-1", "a".repeat(32))
    expect(container.textContent).toContain("Loading the generated image.")
    expect(mocks.getImageGenerationDetails).not.toHaveBeenCalled()
    expect(mocks.fetchImageAssetBlob).not.toHaveBeenCalled()
  })


  it("renders the authenticated object URL without persisting it", () => {
    mocks.useAuthedImage.mockReturnValue({ url: "blob:result", failed: false })
    render()

    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:result")
    expect(JSON.stringify(mocks.node)).not.toContain("blob:result")
  })


  it("fails closed for a cleared cross-board association", () => {
    const data = (mocks.node?.data ?? {}) as {
      properties: Record<string, { type: string; value: string }>
    }
    data.properties.imageAssetUid = { type: "keyword", value: "" }
    render()

    expect(mocks.useAuthedImage).toHaveBeenCalledWith("board-1", null)
    expect(container.textContent).toContain("This generated image is unavailable on this board.")
    expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true)
    expect(mocks.fetchImageAssetBlob).not.toHaveBeenCalled()
  })


  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
  ])("downloads unchanged original %s bytes with a deterministic extension", async (mimeType, extension) => {
    vi.useFakeTimers()
    const blob = new Blob(["original-bytes"], { type: mimeType })
    mocks.fetchImageAssetBlob.mockResolvedValue(blob)
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    click.mockClear()
    render()

    const download = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Download original")!
    await act(async () => {
      download.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.fetchImageAssetBlob).toHaveBeenCalledWith(
      "board-1",
      "a".repeat(32),
      expect.any(AbortSignal),
    )
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledTimes(1)
    const link = click.mock.instances[0] as HTMLAnchorElement | undefined
    expect(link?.download).toBe(`generated-${"g".repeat(32)}.${extension}`)
    expect(link?.isConnected).toBe(false)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download")
    expect(mocks.getImageGenerationDetails).not.toHaveBeenCalled()
  })


  it("times out a stuck download and permits a same-mount retry", async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    mocks.fetchImageAssetBlob.mockImplementationOnce(
      (_graphId: string, _assetUid: string, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise(() => undefined)
      },
    ).mockResolvedValueOnce(new Blob(["recovered"], { type: "image/png" }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    render()

    let download = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Download original")!
    await act(async () => {
      download.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain("Downloading…")
    expect(signals[0]?.aborted).toBe(false)

    await act(() => vi.advanceTimersByTimeAsync(29_999))
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Downloading…")

    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(signals[0]?.aborted).toBe(true)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledWith("The original image could not be downloaded.")
    expect(container.textContent).toContain("Download original")

    download = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Download original")!
    await act(async () => {
      download.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.fetchImageAssetBlob).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })


  it("silently cancels a stuck download when the asset association changes", async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    mocks.fetchImageAssetBlob.mockImplementation(
      (_graphId: string, _assetUid: string, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise(() => undefined)
      },
    )
    render()
    const download = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Download original")!
    await act(async () => {
      download.click()
      await Promise.resolve()
    })

    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, { type: string; value: string }>
    }).properties
    properties.imageAssetUid = { type: "keyword", value: "b".repeat(32) }
    render()

    expect(signals[0]?.aborted).toBe(true)
    expect(container.textContent).toContain("Download original")
    expect(mocks.toastError).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })


  it("shows only safe copy when original download fails", async () => {
    mocks.fetchImageAssetBlob.mockRejectedValue(new Error("provider body and storage path"))
    render()

    const download = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Download original")!
    await act(async () => {
      download.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.toastError).toHaveBeenCalledWith("The original image could not be downloaded.")
    expect(String(mocks.toastError.mock.calls[0])).not.toContain("provider body")
  })


  it("lazily renders prompt, options, and ordered authenticated references", async () => {
    mocks.getImageGenerationDetails.mockResolvedValue({
      generation_uid: "g".repeat(32),
      model_id: "model/one",
      prompt: "first line\nsecond line",
      parameters: { aspect_ratio: "1:1", resolution: "2K", quality: "low", output_count: 1 },
      references: [0, 1, 2].map((ordinal) => ({
        ordinal,
        asset_uid: `asset-${ordinal}`,
        mime_type: "image/png",
        width: 32,
        height: 24,
        content_url: `/asset-${ordinal}/content`,
      })),
    })
    mocks.useAuthedImage.mockImplementation((_graphId: string, assetUid: string | null) => ({
      url: assetUid ? `blob:${assetUid}` : null,
      failed: false,
    }))
    render()
    expect(mocks.getImageGenerationDetails).not.toHaveBeenCalled()

    const details = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Generation details")!
    await act(async () => {
      details.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.getImageGenerationDetails).toHaveBeenCalledWith(
      "board-1",
      "g".repeat(32),
      expect.any(AbortSignal),
    )
    expect(mocks.getImageGenerationDetails).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("first line\nsecond line")
    expect(document.body.textContent).toContain("model/one")
    expect(document.body.textContent).toContain("2K")
    expect(document.body.textContent).toContain("References3")
    expect([...document.body.querySelectorAll<HTMLImageElement>('[aria-label="Generation references"] img')]
      .map((image) => image.alt)).toEqual(["Generation reference 1", "Generation reference 2", "Generation reference 3"])
    expect(mocks.useAuthedImage.mock.calls.slice(-3).map((call) => call[1]))
      .toEqual(["asset-0", "asset-1", "asset-2"])
    expect(mocks.fetchImageAssetBlob).not.toHaveBeenCalled()
  })


  it("aborts an in-flight provenance request when the dialog closes", async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    mocks.getImageGenerationDetails.mockImplementation(
      (_graphId: string, _generationUid: string, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise(() => undefined)
      },
    )
    render()
    const details = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Generation details")!
    await act(async () => {
      details.click()
      await Promise.resolve()
    })
    expect(signals[0]?.aborted).toBe(false)

    const close = document.body.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!
    await act(async () => {
      close.click()
      await Promise.resolve()
    })

    expect(signals[0]?.aborted).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(document.body.textContent).not.toContain("Generation details could not be loaded.")
  })


  it("times out stuck provenance and reloads it after the dialog reopens", async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    mocks.getImageGenerationDetails.mockImplementationOnce(
      (_graphId: string, _generationUid: string, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise(() => undefined)
      },
    ).mockResolvedValueOnce({
      generation_uid: "g".repeat(32),
      model_id: "model/recovered",
      prompt: "recovered prompt",
      parameters: { aspect_ratio: "1:1", resolution: "1K", quality: "low", output_count: 1 },
      references: [],
    })
    render()
    const details = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Generation details")!
    expect(mocks.getImageGenerationDetails).not.toHaveBeenCalled()

    await act(async () => {
      details.click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("Loading generation details.")
    await act(() => vi.advanceTimersByTimeAsync(29_999))
    expect(document.body.textContent).not.toContain("Generation details could not be loaded.")

    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(signals[0]?.aborted).toBe(true)
    expect(document.body.textContent).not.toContain("Loading generation details.")
    expect(document.body.textContent).toContain("Generation details could not be loaded.")

    const close = document.body.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!
    await act(async () => {
      close.click()
      await Promise.resolve()
    })
    await act(async () => {
      details.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.getImageGenerationDetails).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("recovered prompt")
    expect(document.body.textContent).not.toContain("Generation details could not be loaded.")
  })


  it("aborts details on unmount and ignores a stale association response", async () => {
    const signals: AbortSignal[] = []
    let resolveFirst: ((value: Record<string, unknown>) => void) | null = null
    mocks.getImageGenerationDetails.mockImplementationOnce(
      (_graphId: string, _generationUid: string, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise((resolve) => {
          resolveFirst = resolve
        })
      },
    ).mockImplementationOnce(() => new Promise(() => undefined))
    render()
    const details = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Generation details")!
    act(() => details.click())
    expect(signals[0]?.aborted).toBe(false)

    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, { type: string; value: string }>
    }).properties
    properties.generatedImageGenerationUid = { type: "keyword", value: "h".repeat(32) }
    render()
    expect(signals[0]?.aborted).toBe(true)
    await act(async () => {
      resolveFirst?.({
        generation_uid: "g".repeat(32),
        model_id: "stale/model",
        prompt: "stale prompt",
        parameters: {},
        references: [],
      })
      await Promise.resolve()
    })
    expect(document.body.textContent).not.toContain("stale prompt")

    act(() => root.unmount())
    expect((mocks.getImageGenerationDetails.mock.calls[1]?.[2] as AbortSignal).aborted).toBe(true)
    root = createRoot(container)
  })
})
