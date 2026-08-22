import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


const apiMocks = vi.hoisted(() => ({
  getImageGeneration: vi.fn(),
  startImageGeneration: vi.fn(),
}))

vi.mock("@/features/board/api/image-generation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/board/api/image-generation")>(),
  ...apiMocks,
}))

import type { GenerationState } from "@/features/board/api/image-generation"
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
  version: 1,
  boardUid: "board-1",
  generatorNodeUid: "node-1",
  initiatorUserUid: "user-1",
  clientRequestUid: UUID_1,
  modelId: "model-1",
  prompt: "a blue bird",
  parameters: { aspect_ratio: "1:1" },
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
    vi.spyOn(crypto, "randomUUID")
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
      activeGenerationUid: null,
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


  it("recovers an owned pending request with the exact UUID and snapshot", async () => {
    apiMocks.startImageGeneration.mockResolvedValue({ generation_uid: "gen-1", status: "started" })
    const snapshot = pending()
    render({ pendingRequest: snapshot })
    await flush()

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(apiMocks.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestUid: UUID_1,
      modelId: snapshot.modelId,
      prompt: snapshot.prompt,
      parameters: snapshot.parameters,
    }))
  })


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


  it("retains a 409 snapshot and never retries automatically", async () => {
    apiMocks.startImageGeneration.mockRejectedValue(new Error("409 Conflict - secret body"))
    render()
    await act(async () => latest?.generate("model-1", "a blue bird", {}))
    await act(() => vi.advanceTimersByTimeAsync(60_000))

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(latest?.hasPendingRequest).toBe(true)
    expect(persist).not.toHaveBeenCalledWith({ pendingRequest: null })
    expect(latest?.error).not.toContain("secret body")
  })


  it("retains an ambiguous transport snapshot and blocks a new UUID", async () => {
    apiMocks.startImageGeneration
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce({ generation_uid: "gen-recovered", status: "started" })
    render()
    await act(async () => latest?.generate("model-1", "a blue bird", {}))
    await act(async () => latest?.generate("model-1", "a blue bird", {}))

    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(1)
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1)
    expect(persist).not.toHaveBeenCalledWith({ pendingRequest: null })

    await act(async () => latest?.resumePending())
    expect(apiMocks.startImageGeneration).toHaveBeenCalledTimes(2)
    expect(apiMocks.startImageGeneration).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clientRequestUid: UUID_1,
      prompt: "a blue bird",
      parameters: {},
    }))
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1)
  })


  it("clears a known-safe validation rejection", async () => {
    apiMocks.startImageGeneration.mockRejectedValue(new Error("422 Unprocessable Entity - {}"))
    render()
    await act(async () => latest?.generate("model-1", "a blue bird", {}))

    expect(persist).toHaveBeenLastCalledWith({ pendingRequest: null })
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
    expect(persist).toHaveBeenCalledWith({ activeGenerationUid: null, pendingRequest: null })
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
