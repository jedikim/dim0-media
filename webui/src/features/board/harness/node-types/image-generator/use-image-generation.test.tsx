import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const apiMocks = vi.hoisted(() => ({
  getImageGeneration: vi.fn(),
  startImageGeneration: vi.fn(),
}))
const uuidMocks = vi.hoisted(() => ({ uuidv4: vi.fn() }))

vi.mock("@/features/board/api/image-generation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/board/api/image-generation")>(),
  ...apiMocks,
}))
vi.mock("uuid", () => ({ v4: uuidMocks.uuidv4 }))

import type { GenerationState } from "@/features/board/api/image-generation"
import { ImageReferenceResolutionError } from "../../image-reference-resolution"
import type { PendingImageRequest } from "./node-state"
import {
  IMAGE_GENERATION_POLL_CEILING_MS,
  useImageGeneration,
  type UseImageGenerationArgs,
} from "./use-image-generation"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true


const UUID_1 = "11111111-1111-4111-8111-111111111111"
const UUID_2 = "22222222-2222-4222-8222-222222222222"


const generationState = (
  status: GenerationState["status"],
  patch: Partial<GenerationState> = {},
): GenerationState => ({
  generation_uid: "gen-1",
  status,
  model_id: "model-1",
  started_at: "2026-08-21T00:00:00Z",
  completed_at: status === "succeeded" || status === "failed"
    ? "2026-08-21T00:00:01Z"
    : null,
  output_asset_uid: status === "succeeded" ? "asset-1" : null,
  output_content_url: status === "succeeded"
    ? "/boards/board-1/image-assets/asset-1/content"
    : null,
  error_code: status === "failed" ? "provider_failed" : null,
  error_message: status === "failed" ? "Generation failed safely" : null,
  ...patch,
})


const pending = (patch: Partial<PendingImageRequest> = {}): PendingImageRequest => ({
  version: 2,
  boardUid: "board-1",
  generatorNodeUid: "node-1",
  initiatorUserUid: "user-1",
  clientRequestUid: UUID_1,
  modelId: "model-1",
  prompt: "a blue bird",
  parameters: { aspect_ratio: "1:1" },
  referenceSourceNodeUids: [],
  referenceAssetUids: [],
  ...patch,
})


describe("useImageGeneration", () => {
  let container: HTMLDivElement
  let root: Root
  let mounted: boolean
  let latest: ReturnType<typeof useImageGeneration> | null
  let currentArgs: UseImageGenerationArgs
  let persist: ReturnType<typeof vi.fn>


  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mounted = true
    latest = null
    persist = vi.fn()
    currentArgs = {
      graphId: "board-1",
      nodeId: "node-1",
      userId: "user-1",
      activeGenerationUid: null,
      pendingRequest: null,
      canStart: true,
      persist: persist as unknown as UseImageGenerationArgs["persist"],
    }
    apiMocks.getImageGeneration.mockReset()
    apiMocks.startImageGeneration.mockReset()
    uuidMocks.uuidv4.mockReset()
      .mockReturnValueOnce(UUID_1)
      .mockReturnValueOnce(UUID_2)
  })


  afterEach(() => {
    if (mounted) act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })


  const render = (patch: Partial<UseImageGenerationArgs> = {}): void => {
    currentArgs = { ...currentArgs, ...patch }
    const Probe = (): null => {
      latest = useImageGeneration(currentArgs)
      return null
    }
    act(() => root.render(<Probe />))
  }


  const renderStrict = (patch: Partial<UseImageGenerationArgs> = {}): void => {
    currentArgs = { ...currentArgs, ...patch }
    const Probe = (): null => {
      latest = useImageGeneration(currentArgs)
      return null
    }
    act(() => root.render(<StrictMode><Probe /></StrictMode>))
  }


  const flush = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }


  it("polls started to succeeded", async () => {
    apiMocks.getImageGeneration
      .mockResolvedValueOnce(generationState("started"))
      .mockResolvedValueOnce(generationState("succeeded"))
    render({ activeGenerationUid: "gen-1" })
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    expect(latest?.phase).toBe("succeeded")
    expect(latest?.state?.output_asset_uid).toBe("asset-1")
    expect(apiMocks.getImageGeneration).toHaveBeenCalledTimes(2)
    expect(persist).not.toHaveBeenCalledWith({ pendingRequest: null })
  })


  it("continues polling from started through retryable to succeeded", async () => {
    apiMocks.getImageGeneration
      .mockResolvedValueOnce(generationState("started"))
      .mockResolvedValueOnce(generationState("retryable"))
      .mockResolvedValueOnce(generationState("succeeded"))
    render({ activeGenerationUid: "gen-1" })
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(3_000))

    expect(latest?.phase).toBe("succeeded")
    expect(apiMocks.getImageGeneration).toHaveBeenCalledTimes(3)
  })


  it("stops polling at five minutes and marks only the UI as stalled", async () => {
    apiMocks.getImageGeneration.mockResolvedValue(generationState("started"))
    render({ activeGenerationUid: "gen-1" })
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(IMAGE_GENERATION_POLL_CEILING_MS + 10_000))

    expect(latest?.phase).toBe("stalled")
    const calls = apiMocks.getImageGeneration.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(apiMocks.getImageGeneration).toHaveBeenCalledTimes(calls)
    expect(persist).not.toHaveBeenCalledWith(expect.objectContaining({ status: "stalled" }))
  })


  it("rechecks the same stalled generation without POST and can stall again", async () => {
    let status: GenerationState["status"] = "started"
    apiMocks.getImageGeneration.mockImplementation(async () => generationState(status))
    render({ activeGenerationUid: "gen-1" })
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(IMAGE_GENERATION_POLL_CEILING_MS + 10_000))

    expect(latest?.phase).toBe("stalled")
    act(() => latest?.checkStatusAgain())
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(IMAGE_GENERATION_POLL_CEILING_MS + 10_000))
    expect(latest?.phase).toBe("stalled")

    status = "succeeded"
    act(() => latest?.checkStatusAgain())
    await flush()
    expect(latest?.phase).toBe("succeeded")
    expect(apiMocks.getImageGeneration.mock.calls.every((call) => call[1] === "gen-1")).toBe(true)
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
    expect(uuidMocks.uuidv4).not.toHaveBeenCalled()
  })


  it("cancels a pending status fetch and all timers on unmount", async () => {
    let signal: AbortSignal | undefined
    apiMocks.getImageGeneration.mockImplementation((_board, _generation, nextSignal) => {
      signal = nextSignal
      return new Promise(() => undefined)
    })
    render({ activeGenerationUid: "gen-1" })
    await flush()

    act(() => root.unmount())
    mounted = false
    expect(signal?.aborted).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(apiMocks.getImageGeneration).toHaveBeenCalledTimes(1)
  })


  it("uses a new UUID for an explicit logical generation", async () => {
    apiMocks.startImageGeneration.mockResolvedValue({ generation_uid: "gen-new", status: "started" })
    render()

    await act(async () => latest?.generate("model-1", "a blue bird", { aspect_ratio: "1:1" }))

    expect(apiMocks.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestUid: UUID_1,
      referenceAssetUids: [],
    }))
    expect(persist).toHaveBeenNthCalledWith(1, {
      pendingRequest: expect.objectContaining({ clientRequestUid: UUID_1 }),
    })
  })


  it("synchronously blocks a double click while the first POST is unresolved", async () => {
    apiMocks.startImageGeneration.mockReturnValue(new Promise(() => undefined))
    render()

    act(() => {
      void latest?.generate("model-1", "same", {})
      void latest?.generate("model-1", "same", {})
    })
    await flush()

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
  })


  it("resolves ordered references once before creating an immutable pending snapshot", async () => {
    apiMocks.startImageGeneration.mockResolvedValue({ generation_uid: "gen-new", status: "started" })
    const sourceNodeUids = ["image-first", "image-second", "image-third"]
    const resolvedAssetUids = ["a".repeat(32), "b".repeat(32), "c".repeat(32)]
    let release: ((assetUids: string[]) => void) | null = null
    const resolveReferenceAssets = vi.fn(() => new Promise<string[]>((resolve) => {
      release = resolve
    }))
    render({ resolveReferenceAssets })

    let first: Promise<void> | undefined
    act(() => {
      first = latest?.generate("model-1", "ordered bird", {}, sourceNodeUids)
      void latest?.generate("model-1", "ordered bird", {}, sourceNodeUids)
    })
    expect(latest?.phase).toBe("resolving")
    expect(latest?.hasPendingRequest).toBe(false)
    expect(resolveReferenceAssets).toHaveBeenCalledTimes(1)
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()

    await act(async () => {
      release?.(resolvedAssetUids)
      await first
    })
    sourceNodeUids.reverse()
    resolvedAssetUids.reverse()

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(apiMocks.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestUid: UUID_1,
      referenceAssetUids: ["a".repeat(32), "b".repeat(32), "c".repeat(32)],
    }))
    expect(persist).toHaveBeenNthCalledWith(1, {
      pendingRequest: expect.objectContaining({
        referenceSourceNodeUids: ["image-first", "image-second", "image-third"],
        referenceAssetUids: ["a".repeat(32), "b".repeat(32), "c".repeat(32)],
      }),
    })
  })


  it("rejects a collaboration reorder after resolution without pending state or POST", async () => {
    const initial = ["image-first", "image-second"]
    let current = [...initial]
    let release: ((assetUids: string[]) => void) | null = null
    const resolveReferenceAssets = vi.fn(() => new Promise<string[]>((resolve) => {
      release = resolve
    }))
    render({
      resolveReferenceAssets,
      getCurrentReferenceSourceNodeUids: () => [...current],
    })

    let generation: Promise<void> | undefined
    act(() => {
      generation = latest?.generate("model-1", "ordered bird", {}, initial)
    })
    current = ["image-second", "image-first"]
    await act(async () => {
      release?.(["a".repeat(32), "b".repeat(32)])
      await generation
    })

    expect(latest?.phase).toBe("failed")
    expect(latest?.error).toContain("참조 이미지가 변경되었습니다")
    expect(latest?.hasPendingRequest).toBe(false)
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalledWith(expect.objectContaining({
      pendingRequest: expect.anything(),
    }))
  })


  it("keeps a confirmed pending snapshot immutable after later canvas changes", async () => {
    let current = ["image-first"]
    const resolveReferenceAssets = vi.fn().mockResolvedValue(["a".repeat(32)])
    apiMocks.startImageGeneration.mockReturnValue(new Promise(() => undefined))
    render({
      resolveReferenceAssets,
      getCurrentReferenceSourceNodeUids: () => [...current],
    })

    act(() => {
      void latest?.generate("model-1", "ordered bird", {}, ["image-first"])
    })
    await flush()
    current = []
    act(() => {
      void latest?.generate("model-1", "changed bird", {}, [])
    })
    await flush()

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith({
      pendingRequest: expect.objectContaining({
        referenceSourceNodeUids: ["image-first"],
        referenceAssetUids: ["a".repeat(32)],
      }),
    })
    expect(uuidMocks.uuidv4).toHaveBeenCalledTimes(1)
  })


  it("keeps the old preview and permits a clean retry after reference resolution fails", async () => {
    const oldState = generationState("succeeded", {
      generation_uid: "gen-old",
      output_asset_uid: "asset-old",
    })
    apiMocks.getImageGeneration.mockResolvedValue(oldState)
    const resolveReferenceAssets = vi.fn()
      .mockRejectedValueOnce(new ImageReferenceResolutionError("참조 자산을 안전하게 확인할 수 없습니다."))
      .mockResolvedValueOnce(["d".repeat(32)])
    apiMocks.startImageGeneration.mockResolvedValue({ generation_uid: "gen-new", status: "started" })
    render({ activeGenerationUid: "gen-old", resolveReferenceAssets })
    await flush()

    await act(async () => latest?.generate("model-1", "new bird", {}, ["image-1"]))
    await flush()
    expect(latest?.phase).toBe("failed")
    expect(latest?.error).toBe("참조 자산을 안전하게 확인할 수 없습니다.")
    expect(latest?.state?.output_asset_uid).toBe("asset-old")
    expect(latest?.hasPendingRequest).toBe(false)
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalledWith(expect.objectContaining({ pendingRequest: expect.anything() }))

    await act(async () => latest?.generate("model-1", "new bird", {}, ["image-1"]))
    expect(resolveReferenceAssets).toHaveBeenCalledTimes(2)
    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
  })


  it("aborts in-flight reference resolution on unmount without a generation POST", async () => {
    const signalHolder: { current?: AbortSignal } = {}
    let generation: Promise<void> | undefined
    const resolveReferenceAssets = vi.fn((_sourceNodeUids, signal: AbortSignal) => {
      signalHolder.current = signal
      return new Promise<string[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
      })
    })
    render({ resolveReferenceAssets })

    act(() => {
      generation = latest?.generate("model-1", "new bird", {}, ["image-1"])
    })
    await flush()
    act(() => root.unmount())
    mounted = false
    await act(async () => generation)

    expect(signalHolder.current?.aborted).toBe(true)
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })


  it("recovers an owned pending request with the exact UUID and snapshot", async () => {
    apiMocks.startImageGeneration.mockResolvedValue({ generation_uid: "gen-1", status: "started" })
    const snapshot = pending({
      referenceSourceNodeUids: ["image-1", "image-2"],
      referenceAssetUids: ["a".repeat(32), "b".repeat(32)],
    })
    render({ pendingRequest: snapshot })
    await flush()

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(apiMocks.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestUid: UUID_1,
      modelId: snapshot.modelId,
      prompt: snapshot.prompt,
      parameters: snapshot.parameters,
      referenceAssetUids: snapshot.referenceAssetUids,
    }))
  })


  it("recovers an owned pending request exactly once under StrictMode replay", async () => {
    apiMocks.startImageGeneration.mockResolvedValue({ generation_uid: "gen-new", status: "started" })
    const snapshot = pending({ clientRequestUid: UUID_2, prompt: "strict bird" })
    renderStrict({ pendingRequest: snapshot })
    await flush()

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(apiMocks.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestUid: UUID_2,
      modelId: snapshot.modelId,
      prompt: snapshot.prompt,
      parameters: snapshot.parameters,
    }))
    expect(latest?.phase).toBe("running")
    expect(persist).toHaveBeenCalledWith({
      activeGenerationUid: "gen-new",
      pendingRequest: null,
    })
    expect(uuidMocks.uuidv4).not.toHaveBeenCalled()
  })


  it("keeps StrictMode transport recovery resumable with the original UUID", async () => {
    apiMocks.startImageGeneration
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce({ generation_uid: "gen-recovered", status: "started" })
    const snapshot = pending({ clientRequestUid: UUID_2, prompt: "strict retry" })
    renderStrict({ pendingRequest: snapshot })
    await flush()

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(latest?.phase).toBe("failed")
    expect(latest?.canResumePending).toBe(true)
    expect(persist).not.toHaveBeenCalled()

    await act(async () => latest?.resumePending())
    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(2)
    expect(apiMocks.startImageGeneration.mock.calls.every(
      (call) => call[0].clientRequestUid === UUID_2,
    )).toBe(true)
    expect(uuidMocks.uuidv4).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith({
      activeGenerationUid: "gen-recovered",
      pendingRequest: null,
    })
  })


  it("recovers owned pending work even while the previous active result exists", async () => {
    apiMocks.getImageGeneration.mockResolvedValue(generationState("succeeded", {
      generation_uid: "gen-old",
      output_asset_uid: "asset-old",
    }))
    apiMocks.startImageGeneration.mockResolvedValue({
      generation_uid: "gen-new",
      status: "started",
    })
    const snapshot = pending({ clientRequestUid: UUID_2, prompt: "a newer bird" })
    render({ activeGenerationUid: "gen-old", pendingRequest: snapshot })
    await flush()

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(apiMocks.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestUid: UUID_2,
      prompt: "a newer bird",
      parameters: snapshot.parameters,
    }))
    expect(persist).toHaveBeenCalledWith({
      activeGenerationUid: "gen-new",
      pendingRequest: null,
    })
  })


  it.each(["terminal", "404"])(
    "never lets an old active %s clear owned pending work",
    async (outcome) => {
      if (outcome === "terminal") {
        apiMocks.getImageGeneration.mockResolvedValue(generationState("succeeded"))
      } else {
        apiMocks.getImageGeneration.mockRejectedValue(new Error("404 Not Found - {}"))
      }
      apiMocks.startImageGeneration.mockReturnValue(new Promise(() => undefined))
      const snapshot = pending({ clientRequestUid: UUID_2 })
      render({ activeGenerationUid: "gen-old", pendingRequest: snapshot })
      await flush()

      expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
      expect(persist).not.toHaveBeenCalledWith({ pendingRequest: null })
      expect(persist).not.toHaveBeenCalledWith(expect.objectContaining({
        pendingRequest: null,
      }))
    },
  )


  it.each(["terminal", "404"])(
    "preserves another user's pending work after an old active %s",
    async (outcome) => {
      if (outcome === "terminal") {
        apiMocks.getImageGeneration.mockResolvedValue(generationState("succeeded"))
      } else {
        apiMocks.getImageGeneration.mockRejectedValue(new Error("404 Not Found - {}"))
      }
      render({
        activeGenerationUid: "gen-old",
        pendingRequest: pending({ initiatorUserUid: "user-2" }),
      })
      await flush()

      expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
      expect(persist).not.toHaveBeenCalledWith(expect.objectContaining({ pendingRequest: null }))
      expect(latest?.hasPendingRequest).toBe(true)
      if (outcome === "404") {
        expect(persist).toHaveBeenCalledWith({ activeGenerationUid: null })
      }
    },
  )


  it.each([
    ["other board", pending({ boardUid: "board-2" })],
    ["other node", pending({ generatorNodeUid: "node-2" })],
  ])("discards a %s snapshot without a POST", async (_label, snapshot) => {
    render({ pendingRequest: snapshot })
    await flush()

    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith({ pendingRequest: null })
  })


  it("never replays or clears another user's pending recovery key", async () => {
    render({ pendingRequest: pending({ initiatorUserUid: "user-2" }) })
    await flush()

    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(latest?.hasPendingRequest).toBe(true)
    expect(latest?.canResumePending).toBe(false)
  })


  it("clears a 409 conflict and waits for explicit Generate with a new UUID", async () => {
    apiMocks.startImageGeneration
      .mockRejectedValueOnce(new Error("409 Conflict - secret body"))
      .mockResolvedValueOnce({ generation_uid: "gen-new", status: "started" })
    render()
    await act(async () => latest?.generate("model-1", "a blue bird", {}))
    await act(() => vi.advanceTimersByTimeAsync(60_000))

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(latest?.hasPendingRequest).toBe(false)
    expect(latest?.canResumePending).toBe(false)
    expect(persist).toHaveBeenCalledWith({ pendingRequest: null })
    expect(latest?.error).not.toContain("secret body")

    await act(async () => latest?.generate("model-1", "a blue bird", {}))
    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(2)
    expect(apiMocks.startImageGeneration).toHaveBeenLastCalledWith(expect.objectContaining({
      clientRequestUid: UUID_2,
    }))
    expect(uuidMocks.uuidv4).toHaveBeenCalledTimes(2)
  })


  it("clears a determinate generation 413, preserves preview, and retries only with a new UUID", async () => {
    apiMocks.getImageGeneration.mockResolvedValue(generationState("succeeded", {
      generation_uid: "gen-old",
      output_asset_uid: "asset-old",
    }))
    const detail = JSON.stringify({
      detail: {
        code: "reference_too_large",
        message: "provider-controlled message",
      },
    })
    apiMocks.startImageGeneration
      .mockRejectedValueOnce(new Error(`413 Request Entity Too Large - ${detail}`))
      .mockResolvedValueOnce({ generation_uid: "gen-new", status: "started" })
    render({ activeGenerationUid: "gen-old" })
    await flush()

    await act(async () => latest?.generate("model-1", "a new bird", {}))
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(60_000))

    expect(latest?.state?.output_asset_uid).toBe("asset-old")
    expect(latest?.hasPendingRequest).toBe(false)
    expect(latest?.canResumePending).toBe(false)
    expect(latest?.error).toBe("참조 이미지 한 장의 파일 크기가 제한을 초과했습니다.")
    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith({ pendingRequest: null })

    await act(async () => latest?.generate("model-1", "a smaller bird", {}))
    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(2)
    expect(apiMocks.startImageGeneration).toHaveBeenLastCalledWith(expect.objectContaining({
      clientRequestUid: UUID_2,
    }))
  })


  it("treats an upload 413 during resolving as pre-pending and performs no generation POST", async () => {
    const detail = JSON.stringify({
      detail: { code: "reference_too_large", message: "safe" },
    })
    const resolveReferenceAssets = vi.fn().mockRejectedValue(
      new Error(`413 Request Entity Too Large - ${detail}`),
    )
    render({ resolveReferenceAssets })

    await act(async () => latest?.generate("model-1", "a blue bird", {}, ["image-1"]))

    expect(latest?.phase).toBe("failed")
    expect(latest?.hasPendingRequest).toBe(false)
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })


  it("retains an ambiguous transport snapshot and blocks a new UUID", async () => {
    apiMocks.startImageGeneration
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce({ generation_uid: "gen-recovered", status: "started" })
    render()
    await act(async () => latest?.generate("model-1", "a blue bird", {}))
    await act(async () => latest?.generate("model-1", "a blue bird", {}))

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(uuidMocks.uuidv4).toHaveBeenCalledTimes(1)
    expect(persist).not.toHaveBeenCalledWith({ pendingRequest: null })

    await act(async () => latest?.resumePending())
    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(2)
    expect(apiMocks.startImageGeneration).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clientRequestUid: UUID_1,
      prompt: "a blue bird",
      parameters: {},
    }))
    expect(uuidMocks.uuidv4).toHaveBeenCalledTimes(1)
  })


  it("clears a known-safe validation rejection", async () => {
    apiMocks.startImageGeneration.mockRejectedValue(new Error("422 Unprocessable Entity - {}"))
    render()
    await act(async () => latest?.generate("model-1", "a blue bird", {}))

    expect(persist).toHaveBeenLastCalledWith({ pendingRequest: null })
  })


  it.each([
    ["transport", new TypeError("network down")],
    ["5xx", new Error("503 Service Unavailable - provider secret")],
  ])("preserves the previous active preview and pending snapshot after %s", async (_label, failure) => {
    apiMocks.getImageGeneration.mockResolvedValue(generationState("succeeded", {
      generation_uid: "gen-old",
      output_asset_uid: "asset-old",
    }))
    apiMocks.startImageGeneration.mockRejectedValue(failure)
    render({ activeGenerationUid: "gen-old" })
    await flush()
    await act(async () => latest?.generate("model-1", "a new bird", {}))

    expect(latest?.state?.output_asset_uid).toBe("asset-old")
    expect(latest?.hasPendingRequest).toBe(true)
    expect(persist).toHaveBeenCalledWith({
      pendingRequest: expect.objectContaining({ prompt: "a new bird" }),
    })
    expect(persist).not.toHaveBeenCalledWith(expect.objectContaining({
      activeGenerationUid: null,
    }))
    expect(persist).not.toHaveBeenCalledWith({ pendingRequest: null })
  })


  it.each([
    ["transport", new TypeError("network down")],
    ["5xx", new Error("503 Service Unavailable - provider secret")],
  ])(
    "restores the old preview after mounted active plus pending %s recovery fails",
    async (_label, failure) => {
      const oldState = generationState("succeeded", {
        generation_uid: "gen-old",
        output_asset_uid: "asset-old",
      })
      apiMocks.getImageGeneration
        .mockImplementationOnce((_board: string, _generation: string, signal: AbortSignal) => (
          new Promise<GenerationState>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
          })
        ))
        .mockResolvedValueOnce(oldState)
      apiMocks.startImageGeneration.mockRejectedValue(failure)
      const snapshot = pending({ clientRequestUid: UUID_2 })
      render({ activeGenerationUid: "gen-old", pendingRequest: snapshot })
      await flush()
      await flush()

      expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
      expect(apiMocks.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
        clientRequestUid: UUID_2,
      }))
      expect(apiMocks.getImageGeneration).toHaveBeenCalledTimes(2)
      expect(latest?.state?.output_asset_uid).toBe("asset-old")
      expect(latest?.phase).toBe("failed")
      expect(latest?.hasPendingRequest).toBe(true)
      expect(latest?.canResumePending).toBe(true)
      expect(persist).not.toHaveBeenCalledWith({ pendingRequest: null })
      expect(persist).not.toHaveBeenCalledWith({ activeGenerationUid: null })
    },
  )


  it.each([
    ["409", new Error("409 Conflict - secret body"), "요청 식별자가 다른 내용에 이미 사용되었습니다"],
    ["422", new Error("422 Unprocessable Entity - secret body"), "선택한 모델이 이 요청을 지원하지 않습니다"],
  ])(
    "restores the old preview without overwriting a mounted active plus pending %s error",
    async (_label, failure, expectedError) => {
      const oldState = generationState("succeeded", {
        generation_uid: "gen-old",
        output_asset_uid: "asset-old",
      })
      apiMocks.getImageGeneration
        .mockImplementationOnce((_board: string, _generation: string, signal: AbortSignal) => (
          new Promise<GenerationState>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
          })
        ))
        .mockResolvedValueOnce(oldState)
      apiMocks.startImageGeneration.mockRejectedValue(failure)
      render({
        activeGenerationUid: "gen-old",
        pendingRequest: pending({ clientRequestUid: UUID_2 }),
      })
      await flush()
      await flush()

      expect(latest?.state?.output_asset_uid).toBe("asset-old")
      expect(latest?.phase).toBe("failed")
      expect(latest?.error).toContain(expectedError)
      expect(latest?.error).not.toContain("secret body")
      expect(latest?.hasPendingRequest).toBe(false)
      expect(persist).toHaveBeenCalledWith({ pendingRequest: null })
      expect(persist).not.toHaveBeenCalledWith({ activeGenerationUid: null })
    },
  )


  it("ignores a late old-active 404 after a recovered POST returns 202", async () => {
    let rejectOld: ((reason?: unknown) => void) | null = null
    apiMocks.getImageGeneration.mockImplementation(() => (
      new Promise<GenerationState>((_resolve, reject) => {
        rejectOld = reject
      })
    ))
    apiMocks.startImageGeneration.mockResolvedValue({
      generation_uid: "gen-new",
      status: "started",
    })
    render({
      activeGenerationUid: "gen-old",
      pendingRequest: pending({ clientRequestUid: UUID_2 }),
    })
    await flush()

    expect(persist).toHaveBeenCalledWith({
      activeGenerationUid: "gen-new",
      pendingRequest: null,
    })
    await act(async () => {
      rejectOld?.(new Error("404 Not Found - {}"))
      await Promise.resolve()
    })

    expect(persist).not.toHaveBeenCalledWith({ activeGenerationUid: null })
  })


  it("clears only pending after a determinate rejection and keeps the old active", async () => {
    apiMocks.getImageGeneration.mockResolvedValue(generationState("succeeded"))
    apiMocks.startImageGeneration.mockRejectedValue(new Error("422 Unprocessable Entity - {}"))
    render({ activeGenerationUid: "gen-old" })
    await flush()
    await act(async () => latest?.generate("model-1", "a new bird", {}))

    expect(persist).toHaveBeenLastCalledWith({ pendingRequest: null })
    expect(persist).not.toHaveBeenCalledWith(expect.objectContaining({
      activeGenerationUid: null,
    }))
  })


  it("treats an active-generation network error as nonterminal and retries status only", async () => {
    apiMocks.getImageGeneration
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(generationState("succeeded"))
    render({ activeGenerationUid: "gen-1" })
    await flush()
    expect(latest?.phase).toBe("running")
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    expect(latest?.phase).toBe("succeeded")
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
  })


  it("clears a cross-board generation 404 without starting a replacement", async () => {
    apiMocks.getImageGeneration.mockRejectedValue(new Error("404 Not Found - {}"))
    render({ activeGenerationUid: "gen-from-other-board" })
    await flush()

    expect(latest?.phase).toBe("idle")
    expect(persist).toHaveBeenCalledWith({ activeGenerationUid: null })
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
  })


  it("keeps a viewer 404 local without a POST or shared property write", async () => {
    apiMocks.getImageGeneration.mockRejectedValue(new Error("404 Not Found - {}"))
    render({ canStart: false, activeGenerationUid: "gen-missing" })
    await flush()

    expect(latest?.phase).toBe("idle")
    expect(latest?.error).toContain("기존 이미지 생성 기록")
    expect(persist).not.toHaveBeenCalled()
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
  })


  it("lets a same-board clone GET an existing result without a generation POST", async () => {
    apiMocks.getImageGeneration.mockResolvedValue(generationState("succeeded"))
    render({ activeGenerationUid: "gen-existing" })
    await flush()

    expect(apiMocks.getImageGeneration).toHaveBeenCalledTimes(1)
    expect(latest?.state?.output_asset_uid).toBe("asset-1")
    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
  })


  it("starts a new generation on a clone only after explicit Generate", async () => {
    apiMocks.getImageGeneration.mockResolvedValue(generationState("succeeded"))
    apiMocks.startImageGeneration.mockResolvedValue({ generation_uid: "gen-new", status: "started" })
    render({ activeGenerationUid: "gen-existing" })
    await flush()
    await act(async () => latest?.generate("model-1", "new variant", {}))

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(apiMocks.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestUid: UUID_1,
      prompt: "new variant",
    }))
  })


  it("never POSTs or recovers pending work for a viewer", async () => {
    render({ canStart: false, pendingRequest: pending() })
    await flush()
    await act(async () => latest?.generate("model-1", "blocked", {}))

    expect(apiMocks.startImageGeneration).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})
