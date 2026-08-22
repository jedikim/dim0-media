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
  checkStatusAgain: vi.fn(),
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
  let mounted: boolean


  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mounted = true
    mocks.local = false
    mocks.generate.mockReset()
    mocks.resumePending.mockReset()
    mocks.checkStatusAgain.mockReset()
    mocks.listImageModels.mockReset().mockResolvedValue([MODEL])
    mocks.useAuthedImage.mockReset().mockReturnValue({ url: null, failed: false })
    mocks.useImageGeneration.mockReset().mockReturnValue({
      phase: "idle",
      state: null,
      error: null,
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: false,
      canResumePending: false,
    })
    mocks.updateNode.mockReset().mockImplementation((_id, patch: Record<string, unknown>) => {
      mocks.node = { ...mocks.node, ...patch }
    })
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
    if (mounted) act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })


  const render = async (): Promise<void> => {
    await act(async () => {
      root.render(<ImageGeneratorView id={"node-1" as never} />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }


  const inputText = (element: HTMLTextAreaElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  }


  const selectOption = (element: HTMLSelectElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event("change", { bubbles: true }))
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
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: false,
      canResumePending: false,
    })
    await render()

    expect(mocks.useAuthedImage).toHaveBeenCalledWith("board-1", "asset-existing")
    expect(mocks.generate).not.toHaveBeenCalled()
  })


  it("debounces rapid prompt edits and persists only the trailing value", async () => {
    await render()
    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')!

    act(() => {
      inputText(textarea, "a")
      inputText(textarea, "a blue")
      inputText(textarea, "a blue heron")
    })
    expect(mocks.updateNode).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(399))
    expect(mocks.updateNode).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))

    expect(mocks.updateNode).toHaveBeenCalledTimes(1)
    expect(mocks.updateNode).toHaveBeenLastCalledWith("node-1", expect.objectContaining({
      data: expect.objectContaining({
        properties: expect.objectContaining({
          imagePrompt: { type: "text", text: "a blue heron" },
        }),
      }),
    }))
  })


  it("accepts external prompt changes while idle and cancels a draft when pending locks arrive", async () => {
    await render()
    let textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')!
    const data = (mocks.node?.data ?? {}) as { properties: Record<string, unknown> }
    data.properties.imagePrompt = { type: "text", text: "external prompt" }
    await render()
    textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')!
    expect(textarea.value).toBe("external prompt")

    act(() => inputText(textarea, "unsaved local prompt"))
    mocks.useImageGeneration.mockReturnValue({
      phase: "failed",
      state: null,
      error: "확인 필요",
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: true,
      canResumePending: false,
    })
    await render()
    act(() => vi.advanceTimersByTime(1_000))

    textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')!
    expect(textarea.value).toBe("external prompt")
    expect(mocks.updateNode).not.toHaveBeenCalled()
  })


  it("flushes the latest prompt on blur, Generate, and unmount", async () => {
    await render()
    let textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')!

    act(() => {
      inputText(textarea, "blurred prompt")
      textarea.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })
    expect(mocks.updateNode).toHaveBeenCalledTimes(1)

    mocks.updateNode.mockClear()
    act(() => inputText(textarea, "generated prompt"))
    const generateButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")!
    act(() => generateButton.click())

    expect(mocks.generate).toHaveBeenCalledWith("model-1", "generated prompt", {})
    expect(mocks.updateNode).toHaveBeenLastCalledWith("node-1", expect.objectContaining({
      data: expect.objectContaining({
        properties: expect.objectContaining({
          imagePrompt: { type: "text", text: "generated prompt" },
          imageModelId: { type: "keyword", value: "model-1" },
        }),
      }),
    }))

    mocks.updateNode.mockClear()
    textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')!
    act(() => inputText(textarea, "unmounted prompt"))
    act(() => root.unmount())
    mounted = false
    expect(mocks.updateNode).toHaveBeenCalledTimes(1)
    expect(mocks.updateNode.mock.calls[0][1]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        properties: expect.objectContaining({
          imagePrompt: { type: "text", text: "unmounted prompt" },
        }),
      }),
    }))
  })


  it.each([
    ["owned ambiguous", true],
    ["another user", false],
  ])("locks every input while %s pending work exists", async (_label, canResumePending) => {
    mocks.useImageGeneration.mockReturnValue({
      phase: "failed",
      state: null,
      error: "확인 필요",
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: true,
      canResumePending,
    })
    await render()

    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')?.disabled)
      .toBe(true)
    for (const select of container.querySelectorAll("select")) {
      expect(select.disabled).toBe(true)
    }
    const generateButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")
    expect(generateButton?.disabled).toBe(true)
    expect(mocks.generate).not.toHaveBeenCalled()
  })


  it("rechecks a stalled generation with GET-only hook action", async () => {
    mocks.useImageGeneration.mockReturnValue({
      phase: "stalled",
      state: null,
      error: "지연",
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: false,
      canResumePending: false,
    })
    await render()

    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "상태 다시 확인")!
    expect(button).toBeDefined()
    act(() => button.click())
    expect(mocks.checkStatusAgain).toHaveBeenCalledTimes(1)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')?.disabled)
      .toBe(true)
  })


  it("lets a viewer recheck stalled status without generation or shared writes", async () => {
    useBoardAppStore.setState({ canEdit: false })
    mocks.useImageGeneration.mockReturnValue({
      phase: "stalled",
      state: null,
      error: "지연",
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: false,
      canResumePending: false,
    })
    await render()

    const recheckButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "상태 다시 확인")!
    const generateButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.className.includes("bg-primary"))!
    expect(recheckButton.disabled).toBe(false)
    expect(generateButton.disabled).toBe(true)
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')?.disabled)
      .toBe(true)

    act(() => recheckButton.click())
    expect(mocks.checkStatusAgain).toHaveBeenCalledTimes(1)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.resumePending).not.toHaveBeenCalled()
    expect(mocks.updateNode).not.toHaveBeenCalled()
  })


  it("requires explicit replacement when the stored model is unavailable", async () => {
    const data = (mocks.node?.data ?? {}) as { properties: Record<string, unknown> }
    data.properties.imageModelId = { type: "keyword", value: "retired-model" }
    await render()

    const modelSelect = container.querySelector<HTMLSelectElement>('[aria-label="Image model"]')!
    const generateButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")!
    expect(modelSelect.value).toBe("retired-model")
    expect(generateButton.disabled).toBe(true)
    expect(container.textContent).toContain("저장된 모델을 사용할 수 없습니다")
    expect(mocks.generate).not.toHaveBeenCalled()

    act(() => selectOption(modelSelect, "model-1"))
    await render()
    const enabledGenerate = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")!
    expect(enabledGenerate.disabled).toBe(false)
    act(() => enabledGenerate.click())
    expect(mocks.generate).toHaveBeenCalledWith("model-1", "a blue bird", {})
  })


  it("persists a new node's displayed default model before its first Generate", async () => {
    const data = (mocks.node?.data ?? {}) as { properties: Record<string, unknown> }
    delete data.properties.imageModelId
    await render()

    const generateButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")!
    act(() => generateButton.click())

    expect(mocks.generate).toHaveBeenCalledWith("model-1", "a blue bird", {})
    expect(mocks.updateNode).toHaveBeenCalledWith("node-1", expect.objectContaining({
      data: expect.objectContaining({
        properties: expect.objectContaining({
          imageModelId: { type: "keyword", value: "model-1" },
        }),
      }),
    }))
  })
})
