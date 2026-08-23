import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAppStore } from "@/store"
import { useBoardAppStore } from "../../store/board-app-store"


const mocks = vi.hoisted(() => ({
  local: false,
  node: null as Record<string, unknown> | null,
  sourceNodes: new Map<string, Record<string, unknown>>(),
  edges: [] as Record<string, unknown>[],
  getNode: vi.fn(),
  getAllEdges: vi.fn(),
  subscribe: vi.fn(),
  addEdge: vi.fn(),
  getEdge: vi.fn(),
  generateId: vi.fn(),
  removeEdge: vi.fn(),
  updateNode: vi.fn(),
  addImage: vi.fn(),
  nodeTitleProps: vi.fn(),
  subscribers: [] as ((batch: { ops: Record<string, unknown>[] }) => void)[],
  listImageModels: vi.fn(),
  getImageGeneration: vi.fn(),
  useImageGeneration: vi.fn(),
  useOutputNode: vi.fn(),
  useAuthedImage: vi.fn(),
  generate: vi.fn(),
  resumePending: vi.fn(),
  checkStatusAgain: vi.fn(),
}))

vi.mock("@canvas-harness/react", () => ({
  useNode: (id: string) => mocks.getNode(id),
  useCanvasStore: () => ({
    getNode: mocks.getNode,
    getAllEdges: mocks.getAllEdges,
    subscribe: mocks.subscribe,
    addEdge: mocks.addEdge,
    getEdge: mocks.getEdge,
    generateId: mocks.generateId,
    removeEdge: mocks.removeEdge,
    updateNode: mocks.updateNode,
  }),
}))

vi.mock("../../canvas/board-runtime-context", () => ({
  useBoardRuntime: () => ({ local: mocks.local }),
}))

vi.mock("../../shared-views", () => ({
  NodeFooter: () => null,
  NodeTitleCaption: (props: Record<string, unknown>) => {
    mocks.nodeTitleProps(props)
    return <button data-testid="generator-title">{String(props.label ?? props.placeholder)}</button>
  },
  NodeTrafficLights: () => null,
  useStopCanvasGesture: () => undefined,
}))

vi.mock("@/features/board/harness/graph/subtree", () => ({ removeNodeSubtree: vi.fn() }))

vi.mock("../../canvas/use-add-image", () => ({
  useHarnessAddImage: () => mocks.addImage,
}))

vi.mock("@/features/board/api/image-generation", () => ({
  listImageModels: mocks.listImageModels,
  getImageGeneration: mocks.getImageGeneration,
  imageGenerationErrorMessage: () => "모델 목록을 불러올 수 없습니다.",
  imageGenerationStatusCode: (error: unknown) => {
    const match = error instanceof Error ? /^(\d{3})\b/.exec(error.message) : null
    return match ? Number(match[1]) : null
  },
}))

vi.mock("@/features/board/hooks/use-authed-image", () => ({
  useAuthedImage: mocks.useAuthedImage,
}))

vi.mock("./use-image-generation", () => ({
  useImageGeneration: mocks.useImageGeneration,
}))

vi.mock("./use-output-node", () => ({
  useImageGenerationOutputNode: mocks.useOutputNode,
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


const I2I_MODEL = {
  ...MODEL,
  model_id: "model-i2i",
  display_name: "Model I2I",
  supports_image_to_image: true,
  max_reference_images: 3,
}


const LARGE_I2I_MODEL = {
  ...I2I_MODEL,
  model_id: "model-i2i-large",
  display_name: "Model I2I Large",
  max_reference_images: 4,
}


const referenceEdge = (id: string, source: string, ordinal: number) => ({
  id,
  source: { nodeId: source, localOffset: { x: 0, y: 0 } },
  target: { nodeId: "node-1", localOffset: { x: 0, y: 0 } },
  pathStyle: "bezier",
  z: 0,
  groups: [],
  data: {
    imageReference: true,
    imageReferenceOrdinal: ordinal,
    createdAt: `2026-08-22T00:00:0${ordinal}.000Z`,
  },
})


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
    mocks.sourceNodes.clear()
    mocks.edges = []
    mocks.subscribers = []
    mocks.generate.mockReset()
    mocks.resumePending.mockReset()
    mocks.checkStatusAgain.mockReset()
    mocks.addImage.mockReset()
    mocks.nodeTitleProps.mockReset()
    mocks.listImageModels.mockReset().mockResolvedValue([MODEL])
    mocks.getImageGeneration.mockReset()
    mocks.useAuthedImage.mockReset().mockReturnValue({ url: null, failed: false })
    mocks.useOutputNode.mockReset().mockReturnValue({
      outputNodeUid: null,
      nodePresent: false,
      selectResult: vi.fn(),
      recreate: vi.fn(),
      recreating: false,
      error: null,
    })
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
    mocks.updateNode.mockReset().mockImplementation((id, patch: Record<string, unknown>) => {
      if (id === "node-1") {
        mocks.node = { ...mocks.node, ...patch }
        return
      }
      const source = mocks.sourceNodes.get(String(id))
      if (source) mocks.sourceNodes.set(String(id), { ...source, ...patch })
    })
    mocks.getAllEdges.mockReset().mockImplementation(() => mocks.edges)
    mocks.subscribe.mockReset().mockImplementation((_event, subscriber) => {
      mocks.subscribers.push(subscriber)
      return () => {
        mocks.subscribers = mocks.subscribers.filter((candidate) => candidate !== subscriber)
      }
    })
    let generatedId = 0
    mocks.generateId.mockReset().mockImplementation(() => `generated-${generatedId += 1}`)
    mocks.addEdge.mockReset().mockImplementation((edge: Record<string, unknown>) => {
      mocks.edges.push(edge)
      for (const subscriber of mocks.subscribers) {
        subscriber({ ops: [{ type: "edge.add", edge }] })
      }
      return edge.id
    })
    mocks.getEdge.mockReset().mockImplementation((id) => (
      mocks.edges.find((edge) => edge.id === id)
    ))
    mocks.removeEdge.mockReset().mockImplementation((id) => {
      const edge = mocks.edges.find((candidate) => candidate.id === id)
      mocks.edges = mocks.edges.filter((candidate) => candidate.id !== id)
      if (!edge) return
      for (const subscriber of mocks.subscribers) {
        subscriber({ ops: [{ type: "edge.remove", edge }] })
      }
    })
    mocks.node = {
      id: "node-1",
      type: "image-generator",
      x: 500,
      y: 100,
      w: 520,
      h: 560,
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
    mocks.getNode.mockReset().mockImplementation((id: string) => (
      id === "node-1" ? mocks.node : mocks.sourceNodes.get(String(id)) ?? null
    ))
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
    expect(container.querySelector('[aria-label="Add reference images"]')).toBeNull()
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

    expect(mocks.generate).toHaveBeenCalledWith("model-1", "a blue bird", {}, [])
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


  it("renders the hook's safe reference materialization message", async () => {
    const safeMessage = "이 이미지 노드는 참조 자산으로 등록할 수 없습니다."
    mocks.useImageGeneration.mockReturnValue({
      phase: "failed",
      state: { output_asset_uid: "asset-existing" },
      error: safeMessage,
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: false,
      canResumePending: false,
    })
    await render()

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(safeMessage)
  })


  it("does not duplicate-download an existing clone result inside the generator", async () => {
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

    expect(mocks.useAuthedImage).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain("생성된 이미지가 여기에 표시됩니다.")
    expect(mocks.generate).not.toHaveBeenCalled()
  })


  it("stops the generator preview GET after canonical materialization", async () => {
    mocks.useImageGeneration.mockReturnValue({
      phase: "succeeded",
      state: {
        generation_uid: "generation-1",
        status: "succeeded",
        output_asset_uid: "asset-existing",
        output_node_uid: "a".repeat(32),
      },
      error: null,
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      refreshStatus: vi.fn(),
      hasPendingRequest: false,
      canResumePending: false,
    })
    const selectResult = vi.fn()
    mocks.useOutputNode.mockReturnValue({
      outputNodeUid: "a".repeat(32),
      nodePresent: true,
      selectResult,
      recreate: vi.fn(),
      recreating: false,
      error: null,
    })
    await render()

    expect(mocks.useAuthedImage).not.toHaveBeenCalled()
    expect(container.textContent).toContain("완료")
    const select = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "결과로 이동")
    act(() => select?.click())
    expect(selectResult).toHaveBeenCalledTimes(1)
  })


  it("offers explicit deleted-result recovery only to editors", async () => {
    const recreate = vi.fn()
    mocks.useOutputNode.mockReturnValue({
      outputNodeUid: "a".repeat(32),
      nodePresent: false,
      selectResult: vi.fn(),
      recreate,
      recreating: false,
      error: null,
    })
    await render()

    const recovery = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "결과 노드 다시 추가")
    act(() => recovery?.click())
    expect(recreate).toHaveBeenCalledTimes(1)

    useBoardAppStore.setState({ canEdit: false })
    await render()
    expect([...container.querySelectorAll("button")]
      .some((button) => button.textContent === "결과 노드 다시 추가")).toBe(false)
  })


  it("offers same-mount automatic ensure recovery without regenerating", async () => {
    const recreate = vi.fn()
    mocks.useImageGeneration.mockReturnValue({
      phase: "succeeded",
      state: { generation_uid: "generation-1", output_asset_uid: "asset-1" },
      error: null,
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: false,
      canResumePending: false,
    })
    mocks.useOutputNode.mockReturnValue({
      outputNodeUid: null,
      nodePresent: false,
      selectResult: vi.fn(),
      recreate,
      recreating: false,
      error: "결과 노드를 준비하지 못했습니다.",
    })
    await render()

    const recovery = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "결과 노드 추가 다시 시도")
    act(() => recovery?.click())
    expect(recreate).toHaveBeenCalledTimes(1)
    expect(mocks.generate).not.toHaveBeenCalled()

    mocks.useOutputNode.mockReturnValue({
      outputNodeUid: "a".repeat(32),
      nodePresent: true,
      selectResult: vi.fn(),
      recreate,
      recreating: false,
      error: null,
    })
    await render()
    expect(container.textContent).toContain("완료")
    expect(container.textContent).not.toContain("결과 노드 추가 다시 시도")

    useBoardAppStore.setState({ canEdit: false })
    mocks.useOutputNode.mockReturnValue({
      outputNodeUid: null,
      nodePresent: false,
      selectResult: vi.fn(),
      recreate,
      recreating: false,
      error: "결과 노드를 준비하지 못했습니다.",
    })
    await render()
    expect(container.textContent).not.toContain("결과 노드 추가 다시 시도")
    expect(recreate).toHaveBeenCalledTimes(1)
  })


  it("locks generator inputs while an explicit result recreation is running", async () => {
    mocks.useOutputNode.mockReturnValue({
      outputNodeUid: "a".repeat(32),
      nodePresent: false,
      selectResult: vi.fn(),
      recreate: vi.fn(),
      recreating: true,
      error: null,
    })
    await render()

    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Image prompt"]')?.disabled)
      .toBe(true)
    const generateButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "생성 중…")
    expect(generateButton?.disabled).toBe(true)
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

    expect(mocks.generate).toHaveBeenCalledWith("model-1", "generated prompt", {}, [])
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
    expect(mocks.generate).toHaveBeenCalledWith("model-1", "a blue bird", {}, [])
  })


  it("persists a new node's displayed default model before its first Generate", async () => {
    const data = (mocks.node?.data ?? {}) as { properties: Record<string, unknown> }
    delete data.properties.imageModelId
    await render()

    const generateButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")!
    act(() => generateButton.click())

    expect(mocks.generate).toHaveBeenCalledWith("model-1", "a blue bird", {}, [])
    expect(mocks.updateNode).toHaveBeenCalledWith("node-1", expect.objectContaining({
      data: expect.objectContaining({
        properties: expect.objectContaining({
          imageModelId: { type: "keyword", value: "model-1" },
        }),
      }),
    }))
  })


  it("always renders the header title and reference capacity from the API model", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL])
    await render()

    expect(container.querySelector('[data-testid="generator-title"]')?.textContent)
      .toBe("Image Generator")
    expect(mocks.nodeTitleProps).toHaveBeenCalledWith(expect.objectContaining({
      label: undefined,
      placeholder: "Image Generator",
      maxLines: 1,
    }))
    expect(container.textContent).toContain("참조 이미지 0 / 3")
    const option = container.querySelector<HTMLOptionElement>('[aria-label="Image model"] option')
    expect(option?.textContent).toBe("Model I2I · 참조 최대 3장")
    expect(container.querySelector('[aria-label="Image references"]')).not.toBeNull()
  })


  it("renders references in ordinal order and removes the selected edge", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([MODEL, I2I_MODEL])
    mocks.sourceNodes.set("image-first", {
      id: "image-first",
      type: "image",
      data: { graphUid: "board-1", src: "data:image/png;base64,Zmlyc3Q=", properties: {} },
    })
    mocks.sourceNodes.set("image-second", {
      id: "image-second",
      type: "image",
      data: { graphUid: "board-1", src: "data:image/jpeg;base64,c2Vjb25k", properties: {} },
    })
    mocks.sourceNodes.set("image-third", {
      id: "image-third",
      type: "image",
      data: { graphUid: "board-1", src: "data:image/webp;base64,dGhpcmQ=", properties: {} },
    })
    mocks.edges = [
      referenceEdge("edge-second", "image-second", 1),
      referenceEdge("edge-third", "image-third", 2),
      referenceEdge("edge-first", "image-first", 0),
    ]
    await render()

    const references = container.querySelector('[aria-label="Image references"]')!
    expect(references.querySelector("div")?.className).toContain("size-20")
    const images = [...references.querySelectorAll<HTMLImageElement>("img")]
    expect(images.map((image) => image.src)).toEqual([
      "data:image/png;base64,Zmlyc3Q=",
      "data:image/jpeg;base64,c2Vjb25k",
      "data:image/webp;base64,dGhpcmQ=",
    ])
    expect(references.textContent).toContain("1")
    expect(references.textContent).toContain("2")
    expect(references.textContent).toContain("3")
    const modelOptions = [...container.querySelectorAll<HTMLOptionElement>(
      '[aria-label="Image model"] option',
    )]
    expect(modelOptions.map((option) => option.value)).toEqual(["model-i2i"])

    const removeFirst = container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove reference 1"]',
    )!
    act(() => removeFirst.click())
    expect(mocks.removeEdge).toHaveBeenCalledWith("edge-first")

    const generateButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")!
    act(() => generateButton.click())
    expect(mocks.generate).toHaveBeenCalledWith(
      "model-i2i",
      "a blue bird",
      {},
      ["image-second", "image-third"],
    )
  })


  it("shows an initially marked arrow reference in the same UI turn without generation", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL])
    mocks.sourceNodes.set("image-arrow", {
      id: "image-arrow",
      type: "image",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      data: {
        graphUid: "board-1",
        src: "data:image/png;base64,YXJyb3c=",
        properties: {},
      },
    })
    await render()

    act(() => {
      mocks.addEdge(referenceEdge("edge-arrow", "image-arrow", 0))
    })

    expect(container.querySelector<HTMLImageElement>('img[alt="참조 이미지"]')?.src)
      .toBe("data:image/png;base64,YXJyb3c=")
    expect(container.querySelector('input:not([type="file"])')).toBeNull()
    expect(mocks.generate).not.toHaveBeenCalled()
  })


  it("adds multiple uploaded image nodes and reference edges in file order without generation", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL, LARGE_I2I_MODEL])
    let uploadIndex = 0
    mocks.addImage.mockImplementation(async (
      file: File,
      options: { resolvePosition?: (size: { width: number; height: number }) => { x: number; y: number } },
    ) => {
      const sourceId = `uploaded-${uploadIndex += 1}`
      const position = options.resolvePosition?.({ width: 200, height: 120 }) ?? { x: 0, y: 0 }
      mocks.sourceNodes.set(sourceId, {
        id: sourceId,
        type: "image",
        x: position.x,
        y: position.y,
        w: 200,
        h: 120,
        data: {
          graphUid: "board-1",
          src: `data:${file.type};base64,c2FmZQ==`,
          properties: {},
        },
      })
      return sourceId
    })
    await render()

    const input = container.querySelector<HTMLInputElement>('[aria-label="Add reference images"]')!
    const files = [
      new File(["first"], "first.png", { type: "image/png" }),
      new File(["second"], "second.webp", { type: "image/webp" }),
    ]
    Object.defineProperty(input, "files", { configurable: true, value: files })
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      for (let turn = 0; turn < 6; turn += 1) await Promise.resolve()
    })

    expect(mocks.addImage.mock.calls.map((call) => call[0].name))
      .toEqual(["first.png", "second.webp"])
    expect(mocks.edges.map((edge) => ({
      source: (edge.source as { nodeId: string }).nodeId,
      ordinal: (edge.data as { imageReferenceOrdinal: number }).imageReferenceOrdinal,
      marker: (edge.data as { imageReference: boolean }).imageReference,
    }))).toEqual([
      { source: "uploaded-1", ordinal: 0, marker: true },
      { source: "uploaded-2", ordinal: 1, marker: true },
    ])
    expect(mocks.sourceNodes.get("uploaded-1")).toEqual(expect.objectContaining({
      x: 276,
      y: 100,
    }))
    expect(mocks.sourceNodes.get("uploaded-2")).toEqual(expect.objectContaining({
      x: 276,
      y: 236,
    }))
    expect(mocks.updateNode.mock.calls.filter(([nodeId]) => String(nodeId).startsWith("uploaded-")))
      .toHaveLength(0)
    expect(container.querySelectorAll('[aria-label="Image references"] img')).toHaveLength(2)
    expect(mocks.generate).not.toHaveBeenCalled()
  })


  it.each([
    ["viewer", false, "idle"],
    ["busy", true, "running"],
  ])("disables reference upload for a %s generator", async (_label, canEdit, phase) => {
    useBoardAppStore.setState({ canEdit })
    mocks.listImageModels.mockResolvedValue([I2I_MODEL])
    mocks.useImageGeneration.mockReturnValue({
      phase,
      state: null,
      error: null,
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: false,
      canResumePending: false,
    })
    await render()

    expect(container.querySelector<HTMLInputElement>('[aria-label="Add reference images"]')?.disabled)
      .toBe(true)
  })


  it("clears a stale generator thumbnail and polls retryable source B to success", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL])
    const sourceProperties: Record<string, unknown> = {
      activeGenerationUid: { type: "keyword", value: "generation-a" },
    }
    mocks.sourceNodes.set("generator-source", {
      id: "generator-source",
      type: "image-generator",
      data: { graphUid: "board-1", properties: sourceProperties },
    })
    mocks.edges = [referenceEdge("edge-1", "generator-source", 0)]
    mocks.useAuthedImage.mockImplementation((_graphId: string, assetUid: string | null) => ({
      url: assetUid ? `blob:${assetUid}` : null,
      failed: false,
    }))
    mocks.getImageGeneration.mockResolvedValueOnce({
      status: "succeeded",
      output_asset_uid: "asset-a",
    })
    await render()
    expect(container.querySelector<HTMLImageElement>('img[alt="참조 생성 이미지"]')?.src)
      .toBe("blob:asset-a")

    sourceProperties.activeGenerationUid = { type: "keyword", value: "generation-b" }
    mocks.getImageGeneration
      .mockResolvedValueOnce({ status: "started", output_asset_uid: null })
      .mockResolvedValueOnce({ status: "retryable", output_asset_uid: null })
      .mockResolvedValueOnce({ status: "succeeded", output_asset_uid: "asset-b" })
    await render()
    expect(container.querySelector('img[alt="참조 생성 이미지"]')).toBeNull()

    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(container.querySelector<HTMLImageElement>('img[alt="참조 생성 이미지"]')?.src)
      .toBe("blob:asset-b")
    expect(mocks.getImageGeneration.mock.calls.slice(-3).map((call) => call[1]))
      .toEqual(["generation-b", "generation-b", "generation-b"])
  })


  it("retries a transient generator thumbnail GET and then renders success", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL])
    mocks.sourceNodes.set("generator-source", {
      id: "generator-source",
      type: "image-generator",
      data: {
        graphUid: "board-1",
        properties: { activeGenerationUid: { type: "keyword", value: "generation-a" } },
      },
    })
    mocks.edges = [referenceEdge("edge-1", "generator-source", 0)]
    mocks.useAuthedImage.mockImplementation((_graphId: string, assetUid: string | null) => ({
      url: assetUid ? `blob:${assetUid}` : null,
      failed: false,
    }))
    mocks.getImageGeneration
      .mockRejectedValueOnce(new TypeError("temporary network failure"))
      .mockResolvedValueOnce({ status: "succeeded", output_asset_uid: "asset-a" })

    await render()
    expect(container.querySelector('img[alt="참조 생성 이미지"]')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    expect(mocks.getImageGeneration).toHaveBeenCalledTimes(2)
    expect(container.querySelector<HTMLImageElement>('img[alt="참조 생성 이미지"]')?.src)
      .toBe("blob:asset-a")
  })


  it.each([403, 404])("stops thumbnail polling after determinate HTTP %s", async (status) => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL])
    mocks.sourceNodes.set("generator-source", {
      id: "generator-source",
      type: "image-generator",
      data: {
        graphUid: "board-1",
        properties: { activeGenerationUid: { type: "keyword", value: "generation-a" } },
      },
    })
    mocks.edges = [referenceEdge("edge-1", "generator-source", 0)]
    mocks.getImageGeneration.mockRejectedValue(new Error(`${status} - unavailable`))

    await render()
    await act(() => vi.advanceTimersByTimeAsync(30_000))

    expect(mocks.getImageGeneration).toHaveBeenCalledTimes(1)
    expect(container.querySelector('img[alt="참조 생성 이미지"]')).toBeNull()
  })


  it("aborts an in-flight reference status GET at the exact five-minute deadline", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL])
    mocks.sourceNodes.set("generator-source", {
      id: "generator-source",
      type: "image-generator",
      data: {
        graphUid: "board-1",
        properties: { activeGenerationUid: { type: "keyword", value: "generation-a" } },
      },
    })
    mocks.edges = [referenceEdge("edge-1", "generator-source", 0)]
    let capturedSignal: AbortSignal | undefined
    mocks.getImageGeneration.mockImplementation(
      (_graphId: string, _generationUid: string, signal?: AbortSignal) => {
        capturedSignal = signal
        return new Promise(() => undefined)
      },
    )

    await render()
    expect(capturedSignal?.aborted).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(5 * 60 * 1_000 - 1))
    expect(capturedSignal?.aborted).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(capturedSignal?.aborted).toBe(true)
    expect(mocks.getImageGeneration).toHaveBeenCalledTimes(1)
  })


  it("never restores A after B fails or a late A response arrives", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL])
    const sourceProperties: Record<string, unknown> = {
      activeGenerationUid: { type: "keyword", value: "generation-a" },
    }
    mocks.sourceNodes.set("generator-source", {
      id: "generator-source",
      type: "image-generator",
      data: { graphUid: "board-1", properties: sourceProperties },
    })
    mocks.edges = [referenceEdge("edge-1", "generator-source", 0)]
    mocks.useAuthedImage.mockImplementation((_graphId: string, assetUid: string | null) => ({
      url: assetUid ? `blob:${assetUid}` : null,
      failed: false,
    }))
    let resolveA: ((value: { status: string; output_asset_uid: string }) => void) | null = null
    mocks.getImageGeneration.mockImplementationOnce(() => new Promise((resolve) => {
      resolveA = resolve
    }))
    await render()

    sourceProperties.activeGenerationUid = { type: "keyword", value: "generation-b" }
    mocks.getImageGeneration.mockResolvedValueOnce({ status: "failed", output_asset_uid: null })
    await render()
    expect(container.querySelector('img[alt="참조 생성 이미지"]')).toBeNull()

    await act(async () => {
      resolveA?.({ status: "succeeded", output_asset_uid: "asset-a" })
      await Promise.resolve()
    })
    expect(container.querySelector('img[alt="참조 생성 이미지"]')).toBeNull()
  })


  it("does not invent a zero reference limit while models are pending", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    for (let index = 0; index < 2; index += 1) {
      const source = `pending-image-${index}`
      mocks.sourceNodes.set(source, {
        id: source,
        type: "image",
        data: { graphUid: "board-1", src: "data:image/png;base64,c2FmZQ==", properties: {} },
      })
      mocks.edges.push(referenceEdge(`pending-edge-${index}`, source, index))
    }
    mocks.listImageModels.mockReturnValue(new Promise(() => undefined))

    await render()

    expect(container.textContent).toContain("참조 이미지 2 / —")
    expect(container.textContent).not.toContain("초과")
    expect(container.querySelector('[aria-label="Image references"]')?.innerHTML)
      .not.toContain("border-destructive")
  })


  it("keeps reference limits unresolved after a safe model-list failure", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.sourceNodes.set("failed-image", {
      id: "failed-image",
      type: "image",
      data: { graphUid: "board-1", src: "data:image/png;base64,c2FmZQ==", properties: {} },
    })
    mocks.edges.push(referenceEdge("failed-edge", "failed-image", 0))
    mocks.listImageModels.mockRejectedValue(new Error("provider secret"))

    await render()

    expect(container.textContent).toContain("참조 이미지 1 / —")
    expect(container.textContent).not.toContain("1 / 0")
    expect(container.textContent).not.toContain("초과")
    expect(container.querySelector('[aria-label="Image references"]')?.innerHTML)
      .not.toContain("border-destructive")
  })


  it("keeps over-limit references visible until a larger model restores validity", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL, LARGE_I2I_MODEL])
    for (let index = 0; index < 4; index += 1) {
      const source = `image-${index}`
      mocks.sourceNodes.set(source, {
        id: source,
        type: "image",
        data: { graphUid: "board-1", src: "data:image/png;base64,c2FmZQ==", properties: {} },
      })
      mocks.edges.push(referenceEdge(`edge-${index}`, source, index))
    }
    await render()

    const generateButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")!
    expect(generateButton.disabled).toBe(true)
    expect(container.textContent).toContain("참조 이미지 4 / 3 · 1장 초과")
    expect(container.textContent).toContain("1장을 제거하거나 참조 한도가 더 큰 모델")
    expect([...container.querySelectorAll('[aria-label="Image references"] span')]
      .filter((badge) => badge.textContent === "초과")).toHaveLength(1)
    expect(container.querySelectorAll('[aria-label="Image references"] img')).toHaveLength(4)
    expect(mocks.generate).not.toHaveBeenCalled()

    const modelSelect = container.querySelector<HTMLSelectElement>('[aria-label="Image model"]')!
    act(() => selectOption(modelSelect, "model-i2i-large"))
    await render()

    const restoredGenerate = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Generate")!
    expect(restoredGenerate.disabled).toBe(false)
    expect(container.textContent).toContain("참조 이미지 4 / 4")
    expect(container.textContent).not.toContain("장 초과")
  })


  it("locks reference removal throughout local resolving", async () => {
    const properties = ((mocks.node?.data ?? {}) as {
      properties: Record<string, unknown>
    }).properties
    properties.imageModelId = { type: "keyword", value: "model-i2i" }
    mocks.listImageModels.mockResolvedValue([I2I_MODEL])
    mocks.sourceNodes.set("image-1", {
      id: "image-1",
      type: "image",
      data: { graphUid: "board-1", src: "data:image/png;base64,c2FmZQ==", properties: {} },
    })
    mocks.edges = [referenceEdge("edge-1", "image-1", 0)]
    mocks.useImageGeneration.mockReturnValue({
      phase: "resolving",
      state: null,
      error: null,
      generate: mocks.generate,
      resumePending: mocks.resumePending,
      checkStatusAgain: mocks.checkStatusAgain,
      hasPendingRequest: false,
      canResumePending: false,
    })
    await render()

    expect(container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove reference 1"]',
    )?.disabled).toBe(true)
    expect(container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Image prompt"]',
    )?.disabled).toBe(true)
    const generateButton = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "생성 중…")
    expect(generateButton?.disabled).toBe(true)
  })
})
