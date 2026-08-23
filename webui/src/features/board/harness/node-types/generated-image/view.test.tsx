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
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
  })


  const render = (): void => {
    act(() => root.render(<GeneratedImageView id={"result-1" as never} />))
  }


  it("loads only its immutable board asset through the authenticated hook", () => {
    render()

    expect(mocks.useAuthedImage).toHaveBeenCalledWith("board-1", "a".repeat(32))
    expect(container.textContent).toContain("생성 이미지를 불러오는 중입니다.")
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
    expect(container.textContent).toContain("이 생성 이미지는 이 보드에서 사용할 수 없습니다.")
    expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true)
    expect(mocks.fetchImageAssetBlob).not.toHaveBeenCalled()
  })


  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
  ])("downloads unchanged original %s bytes with a deterministic extension", async (mimeType, extension) => {
    const blob = new Blob(["original-bytes"], { type: mimeType })
    mocks.fetchImageAssetBlob.mockResolvedValue(blob)
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    click.mockClear()
    render()

    const download = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "원본 다운로드")!
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
    expect((click.mock.instances[0] as HTMLAnchorElement | undefined)?.download)
      .toBe(`generated-${"g".repeat(32)}.${extension}`)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download")
    expect(mocks.getImageGenerationDetails).not.toHaveBeenCalled()
  })


  it("shows only safe copy when original download fails", async () => {
    mocks.fetchImageAssetBlob.mockRejectedValue(new Error("provider body and storage path"))
    render()

    const download = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "원본 다운로드")!
    await act(async () => {
      download.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.toastError).toHaveBeenCalledWith("원본 이미지를 다운로드하지 못했습니다.")
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
      .find((button) => button.textContent === "생성 정보")!
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
    expect(document.body.textContent).toContain("3장")
    expect([...document.body.querySelectorAll<HTMLImageElement>('[aria-label="Generation references"] img')]
      .map((image) => image.alt)).toEqual(["생성 참조 1", "생성 참조 2", "생성 참조 3"])
    expect(mocks.useAuthedImage.mock.calls.slice(-3).map((call) => call[1]))
      .toEqual(["asset-0", "asset-1", "asset-2"])
    expect(mocks.fetchImageAssetBlob).not.toHaveBeenCalled()
  })


  it("aborts an in-flight provenance request when the dialog closes", async () => {
    const signals: AbortSignal[] = []
    mocks.getImageGenerationDetails.mockImplementation(
      (_graphId: string, _generationUid: string, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise(() => undefined)
      },
    )
    render()
    const details = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "생성 정보")!
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
      .find((button) => button.textContent === "생성 정보")!
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
