import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAppStore } from "@/store"
import { useBoardAppStore } from "../../store/board-app-store"


const mocks = vi.hoisted(() => ({
  local: false,
  node: null as Record<string, unknown> | null,
  getNode: vi.fn(),
  updateNode: vi.fn(),
  listImageModels: vi.fn(),
  useImageGeneration: vi.fn(),
  useAuthedImage: vi.fn(),
  generate: vi.fn(),
  resumePending: vi.fn(),
}))

vi.mock("@canvas-harness/react", () => ({
  useNode: () => mocks.node,
  useCanvasStore: () => ({ getNode: mocks.getNode, updateNode: mocks.updateNode }),
}))

vi.mock("../../canvas/board-runtime-context", () => ({
  useBoardRuntime: () => ({ local: mocks.local }),
}))

vi.mock("../../shared-views", () => ({
  NodeFooter: () => null,
  NodeTitleCaption: () => null,
  NodeTrafficLights: () => null,
  useStopCanvasGesture: () => undefined,
}))

vi.mock("@/features/board/harness/graph/subtree", () => ({ removeNodeSubtree: vi.fn() }))

vi.mock("@/features/board/api/image-generation", () => ({
  listImageModels: mocks.listImageModels,
  imageGenerationErrorMessage: () => "모델 목록을 불러올 수 없습니다.",
}))

vi.mock("@/features/board/hooks/use-authed-image", () => ({
  useAuthedImage: mocks.useAuthedImage,
}))

vi.mock("./use-image-generation", () => ({
  useImageGeneration: mocks.useImageGeneration,
}))

import { ImageGeneratorView } from "./view"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true


const MODEL = {
  model_id: "model-1",
  display_name: "Model One",
  supports_text_to_image: true,
  supports_image_to_image: false,
  max_reference_images: 0,
  supported_resolutions: ["1K"],
  supported_aspect_ratios: ["1:1"],
  supported_qualities: ["low"],
  max_output_images: 1,
  verified_at: "2026-08-21",
}


describe("ImageGeneratorView", () => {
  let container: HTMLDivElement
  let root: Root


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.local = false
    mocks.generate.mockReset()
    mocks.resumePending.mockReset()
    mocks.listImageModels.mockReset().mockResolvedValue([MODEL])
    mocks.useAuthedImage.mockReset().mockReturnValue({ url: null, failed: false })
    mocks.useImageGeneration.mockReset().mockReturnValue({
      phase: "idle",
      state: null,
      error: null,
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      hasPendingRequest: false,
      canResumePending: false,
    })
    mocks.updateNode.mockReset()
    mocks.node = {
      id: "node-1",
      data: {
        noteType: "note",
        styleType: "rectangle",
        version: 1,
        graphUid: "board-1",
        properties: {
          imagePrompt: { type: "text", text: "a blue bird" },
          imageModelId: { type: "keyword", value: "model-1" },
        },
      },
    }
    mocks.getNode.mockReset().mockImplementation(() => mocks.node)
    useBoardAppStore.setState({ canEdit: true })
    useAppStore.setState({ userId: "user-1" })
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })


  const render = async (): Promise<void> => {
    await act(async () => {
      root.render(<ImageGeneratorView id={"node-1" as never} />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }


  it("renders guidance and makes no image API request on a local board", async () => {
    mocks.local = true
    await render()

    expect(container.textContent).toContain("서버 보드에서만 사용할 수 있습니다.")
    expect(mocks.listImageModels).not.toHaveBeenCalled()
    expect(mocks.useImageGeneration).not.toHaveBeenCalled()
    expect(mocks.useAuthedImage).not.toHaveBeenCalled()
  })


  it("disables Generate for a viewer", async () => {
    useBoardAppStore.setState({ canEdit: false })
    await render()

    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")
    expect(button?.disabled).toBe(true)
    expect(mocks.useImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ canStart: false }))
  })


  it("does not render selectors for null capabilities", async () => {
    mocks.listImageModels.mockResolvedValue([{
      ...MODEL,
      supported_resolutions: null,
      supported_aspect_ratios: null,
      supported_qualities: null,
    }])
    await render()

    expect(container.querySelector('[aria-label="비율"]')).toBeNull()
    expect(container.querySelector('[aria-label="해상도"]')).toBeNull()
    expect(container.querySelector('[aria-label="품질"]')).toBeNull()
  })


  it("excludes stale saved options from the POST parameters", async () => {
    const data = (mocks.node?.data ?? {}) as { properties: Record<string, unknown> }
    data.properties.imageAspectRatio = { type: "keyword", value: "4:3" }
    data.properties.imageResolution = { type: "keyword", value: "4K" }
    data.properties.imageQuality = { type: "keyword", value: "ultra" }
    await render()

    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")
    act(() => button?.click())

    expect(mocks.generate).toHaveBeenCalledWith("model-1", "a blue bird", {})
  })


  it("disables Generate and shows safe copy when model loading fails", async () => {
    mocks.listImageModels.mockRejectedValue(new Error("provider secret"))
    await render()

    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")
    expect(button?.disabled).toBe(true)
    expect(container.textContent).toContain("모델 목록을 불러올 수 없습니다.")
    expect(container.textContent).not.toContain("provider secret")
  })


  it("loads an existing clone result through the authenticated asset hook only", async () => {
    mocks.useImageGeneration.mockReturnValue({
      phase: "succeeded",
      state: { output_asset_uid: "asset-existing" },
      error: null,
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      hasPendingRequest: false,
      canResumePending: false,
    })
    await render()

    expect(mocks.useAuthedImage).toHaveBeenCalledWith("board-1", "asset-existing")
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
