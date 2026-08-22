import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const mocks = vi.hoisted(() => ({
  node: null as Record<string, unknown> | null,
  useAuthedImage: vi.fn(),
}))

vi.mock("@canvas-harness/react", () => ({
  useNode: () => mocks.node,
}))

vi.mock("@/features/board/hooks/use-authed-image", () => ({
  useAuthedImage: mocks.useAuthedImage,
}))

import { GeneratedImageView } from "./view"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true


describe("GeneratedImageView", () => {
  let container: HTMLDivElement
  let root: Root


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.useAuthedImage.mockReset().mockReturnValue({ url: null, failed: false })
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
  })


  const render = (): void => {
    act(() => root.render(<GeneratedImageView id={"result-1" as never} />))
  }


  it("loads only its immutable board asset through the authenticated hook", () => {
    render()

    expect(mocks.useAuthedImage).toHaveBeenCalledWith("board-1", "a".repeat(32))
    expect(container.textContent).toContain("생성 이미지를 불러오는 중입니다.")
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
  })
})
