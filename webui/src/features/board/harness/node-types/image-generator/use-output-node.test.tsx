import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCanvasStore, type CanvasStore } from "@canvas-harness/core"


const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  refresh: vi.fn(),
}))


vi.mock("@/features/board/api/image-generation", () => ({
  ensureImageGenerationOutputNode: mocks.ensure,
  imageGenerationErrorMessage: () => "안전한 결과 노드 오류",
  imageGenerationErrorDetail: (error: unknown) => {
    if (!(error instanceof Error)) return null
    const delimiter = error.message.indexOf(" - ")
    if (delimiter < 0) return null
    try {
      const parsed = JSON.parse(error.message.slice(delimiter + 3)) as {
        detail?: { code?: unknown; message?: unknown }
      }
      return typeof parsed.detail?.code === "string"
        && typeof parsed.detail.message === "string"
        ? parsed.detail
        : null
    } catch {
      return null
    }
  },
  imageGenerationStatusCode: (error: unknown) => {
    const match = error instanceof Error ? /^(\d{3})\b/.exec(error.message) : null
    return match ? Number(match[1]) : null
  },
}))

import type { GenerationState } from "@/features/board/api/image-generation"
import {
  AUTOMATIC_ENSURE_DEADLINE_MS,
  EXPLICIT_RECREATE_DEADLINE_MS,
  useImageGenerationOutputNode,
} from "./use-output-node"


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true


const BOARD_ID = "board-1"
const OUTPUT_NODE_UID = "a".repeat(32)
const OUTPUT_ASSET_UID = "b".repeat(32)


const generation = (
  uid: string,
  updates: Partial<GenerationState> = {},
): GenerationState => ({
  generation_uid: uid,
  status: "succeeded",
  model_id: "model-1",
  started_at: "2026-08-22T00:00:00Z",
  completed_at: "2026-08-22T00:00:01Z",
  output_node_uid: null,
  output_asset_uid: OUTPUT_ASSET_UID,
  output_content_url: `/assets/${OUTPUT_ASSET_UID}`,
  error_code: null,
  error_message: null,
  ...updates,
})


const successfulOutcome = (generationUid: string) => ({
  generation_uid: generationUid,
  output_node_uid: OUTPUT_NODE_UID,
  output_asset_uid: OUTPUT_ASSET_UID,
  created: true,
  recreated: false,
})


const outputNodeError = (code: string): Error => new Error(
  `409 Conflict - ${JSON.stringify({ detail: { code, message: "safe server copy" } })}`,
)


type OutputNodeProbeProps = {
  generation: GenerationState | null
  canEdit: boolean
  store: CanvasStore
  onResult: (value: ReturnType<typeof useImageGenerationOutputNode>) => void
}


/** Keep one component identity while tests rerender generation props. */
function OutputNodeProbe(props: OutputNodeProbeProps): null {
  props.onResult(useImageGenerationOutputNode({
    graphId: BOARD_ID,
    generation: props.generation,
    canEdit: props.canEdit,
    store: props.store,
    refreshStatus: mocks.refresh,
  }))
  return null
}


describe("useImageGenerationOutputNode", () => {
  let container: HTMLDivElement
  let root: Root
  let store: CanvasStore
  let latest: ReturnType<typeof useImageGenerationOutputNode> | null


  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    store = createCanvasStore()
    latest = null
    mocks.ensure.mockReset().mockImplementation(
      (_boardId: string, generationUid: string) => Promise.resolve(
        successfulOutcome(generationUid),
      ),
    )
    mocks.refresh.mockReset()
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })


  const render = async (
    state: GenerationState | null,
    { canEdit = true, strict = false }: { canEdit?: boolean; strict?: boolean } = {},
  ): Promise<void> => {
    const probe = (
      <OutputNodeProbe
        generation={state}
        canEdit={canEdit}
        store={store}
        onResult={(value) => { latest = value }}
      />
    )
    await act(async () => {
      root.render(strict ? <StrictMode>{probe}</StrictMode> : probe)
      await Promise.resolve()
      await Promise.resolve()
    })
  }


  it("shares one automatic PUT across StrictMode effects and refreshes status", async () => {
    await render(generation("generation-strict"), { strict: true })

    expect(mocks.ensure).toHaveBeenCalledTimes(1)
    expect(mocks.ensure).toHaveBeenCalledWith(
      BOARD_ID,
      "generation-strict",
      false,
      expect.any(AbortSignal),
    )
    expect(latest?.outputNodeUid).toBe(OUTPUT_NODE_UID)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })


  it("makes no automatic mutation for viewers or already-bound generations", async () => {
    await render(generation("generation-viewer"), { canEdit: false })
    expect(mocks.ensure).not.toHaveBeenCalled()

    await render(generation("generation-bound", { output_node_uid: OUTPUT_NODE_UID }))
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(latest?.outputNodeUid).toBe(OUTPUT_NODE_UID)
  })


  it("updates result presence only for matching node add/remove batches", async () => {
    const getNode = vi.spyOn(store, "getNode")
    await render(generation("generation-presence", { output_node_uid: OUTPUT_NODE_UID }))
    const baselineReads = getNode.mock.calls.length

    act(() => {
      store.addNode({
        id: "unrelated" as Parameters<CanvasStore["getNode"]>[0],
        type: "rect",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        angle: 0,
        groups: [],
      })
    })
    expect(getNode.mock.calls.length).toBe(baselineReads)

    act(() => {
      store.addNode({
        id: OUTPUT_NODE_UID as Parameters<CanvasStore["getNode"]>[0],
        type: "generated-image",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        angle: 0,
        groups: [],
      })
    })
    expect(getNode.mock.calls.length).toBeGreaterThan(baselineReads)
    expect(latest?.nodePresent).toBe(true)
  })


  it("retries only transient response loss with the same idempotent PUT", async () => {
    mocks.ensure
      .mockRejectedValueOnce(new TypeError("temporary transport failure"))
      .mockRejectedValueOnce(new Error("429 unavailable"))
      .mockResolvedValueOnce(successfulOutcome("generation-retry"))

    await render(generation("generation-retry"))
    expect(mocks.ensure).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(mocks.ensure).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(500))

    expect(mocks.ensure).toHaveBeenCalledTimes(3)
    expect(mocks.ensure.mock.calls).toEqual([
      [BOARD_ID, "generation-retry", false, expect.any(AbortSignal)],
      [BOARD_ID, "generation-retry", false, expect.any(AbortSignal)],
      [BOARD_ID, "generation-retry", false, expect.any(AbortSignal)],
    ])
    expect(latest?.outputNodeUid).toBe(OUTPUT_NODE_UID)
  })


  it("retries only materialization_raced 409 and applies the recovered node", async () => {
    const signals: AbortSignal[] = []
    mocks.ensure.mockImplementation(
      (_boardId: string, generationUid: string, _recreate: boolean, signal: AbortSignal) => {
        signals.push(signal)
        return signals.length === 1
          ? Promise.reject(outputNodeError("materialization_raced"))
          : Promise.resolve(successfulOutcome(generationUid))
      },
    )

    await render(generation("generation-materialization-race"))
    expect(mocks.ensure).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(250))

    expect(mocks.ensure.mock.calls).toEqual([
      [BOARD_ID, "generation-materialization-race", false, expect.any(AbortSignal)],
      [BOARD_ID, "generation-materialization-race", false, expect.any(AbortSignal)],
    ])
    expect(signals[0]).toBe(signals[1])
    expect(signals[0]?.aborted).toBe(false)
    expect(latest?.outputNodeUid).toBe(OUTPUT_NODE_UID)
    expect(latest?.error).toBeNull()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })


  it.each([
    ["canonical collision", outputNodeError("canonical_collision")],
    ["other structured conflict", outputNodeError("output_binding_conflict")],
    ["unstructured conflict", new Error("409 Conflict - private response")],
  ])("does not retry a terminal %s", async (_label, failure) => {
    mocks.ensure.mockRejectedValueOnce(failure)

    await render(generation(`generation-terminal-${_label}`))
    await act(() => vi.advanceTimersByTimeAsync(5_000))

    expect(mocks.ensure).toHaveBeenCalledTimes(1)
    expect(latest?.error).toBe("안전한 결과 노드 오류")
  })


  it("bounds repeated materialization races to the existing attempt limit", async () => {
    mocks.ensure.mockRejectedValue(outputNodeError("materialization_raced"))

    await render(generation("generation-race-limit"))
    await act(() => vi.advanceTimersByTimeAsync(250))
    await act(() => vi.advanceTimersByTimeAsync(500))
    await act(() => vi.advanceTimersByTimeAsync(AUTOMATIC_ENSURE_DEADLINE_MS))

    expect(mocks.ensure).toHaveBeenCalledTimes(3)
    expect(latest?.outputNodeUid).toBeNull()
    expect(latest?.error).toBe("안전한 결과 노드 오류")
  })


  it("aborts a scheduled race retry when the generation changes", async () => {
    const signals: AbortSignal[] = []
    mocks.ensure.mockImplementation(
      (_boardId: string, generationUid: string, _recreate: boolean, signal: AbortSignal) => {
        signals.push(signal)
        return generationUid === "generation-race-old"
          ? Promise.reject(outputNodeError("materialization_raced"))
          : Promise.resolve(successfulOutcome(generationUid))
      },
    )
    await render(generation("generation-race-old"))

    await render(generation("generation-race-new"))
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    expect(signals[0]?.aborted).toBe(true)
    expect(mocks.ensure).toHaveBeenCalledTimes(2)
    expect(latest?.outputNodeUid).toBe(OUTPUT_NODE_UID)
    expect(latest?.error).toBeNull()
  })


  it.each(["success", "error"] as const)(
    "ignores a late old-generation retry %s after an in-place rerender",
    async (lateResult) => {
      const oldGenerationUid = `generation-late-old-${lateResult}`
      const newGenerationUid = `generation-late-new-${lateResult}`
      let oldAttempts = 0
      let resolveOld: ((value: ReturnType<typeof successfulOutcome>) => void) | null = null
      let rejectOld: ((error: Error) => void) | null = null
      mocks.ensure.mockImplementation(
        (_boardId: string, generationUid: string, _recreate: boolean, signal: AbortSignal) => {
          if (generationUid === oldGenerationUid) {
            oldAttempts += 1
            if (oldAttempts === 1) {
              return Promise.reject(outputNodeError("materialization_raced"))
            }
            return new Promise((resolve, reject) => {
              resolveOld = resolve
              rejectOld = reject
            })
          }
          expect(signal.aborted).toBe(false)
          return Promise.resolve({
            ...successfulOutcome(generationUid),
            output_node_uid: "c".repeat(32),
          })
        },
      )

      await render(generation(oldGenerationUid))
      await act(() => vi.advanceTimersByTimeAsync(250))
      expect(mocks.ensure).toHaveBeenCalledTimes(2)
      const oldSignal = mocks.ensure.mock.calls[1]?.[3] as AbortSignal

      await render(generation(newGenerationUid))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(oldSignal.aborted).toBe(true)
      expect(mocks.ensure).toHaveBeenCalledTimes(3)

      await act(async () => {
        if (lateResult === "success") {
          resolveOld?.(successfulOutcome(oldGenerationUid))
        } else {
          rejectOld?.(outputNodeError("materialization_raced"))
        }
        await Promise.resolve()
      })
      await act(() => vi.advanceTimersByTimeAsync(1_000))

      expect(mocks.ensure).toHaveBeenCalledTimes(3)
      expect(latest?.outputNodeUid).toBe("c".repeat(32))
      expect(latest?.error).toBeNull()
      expect(mocks.refresh).toHaveBeenCalledTimes(1)
    },
  )


  it("does not schedule a late transient retry after a real unmount", async () => {
    let rejectPending: ((error: Error) => void) | null = null
    const signals: AbortSignal[] = []
    mocks.ensure.mockImplementation(
      (_boardId: string, _generationUid: string, _recreate: boolean, requestSignal: AbortSignal) => {
        signals.push(requestSignal)
        if (signals.length === 1) {
          return Promise.reject(outputNodeError("materialization_raced"))
        }
        return new Promise((_resolve, reject) => { rejectPending = reject })
      },
    )
    await render(generation("generation-race-unmount"))
    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(mocks.ensure).toHaveBeenCalledTimes(2)

    act(() => root.unmount())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(signals[1]?.aborted).toBe(true)
    await act(async () => {
      rejectPending?.(outputNodeError("materialization_raced"))
      await Promise.resolve()
    })
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    expect(mocks.ensure).toHaveBeenCalledTimes(2)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })


  it("stops on determinate errors and exposes only mapped copy", async () => {
    mocks.ensure.mockRejectedValueOnce(new Error("403 private server body"))

    await render(generation("generation-denied"))
    await act(() => vi.advanceTimersByTimeAsync(5_000))

    expect(mocks.ensure).toHaveBeenCalledTimes(1)
    expect(latest?.error).toBe("안전한 결과 노드 오류")
    expect(latest?.error).not.toContain("private server body")
  })


  it("aborts a hanging automatic ensure at the hard deadline and permits remount retry", async () => {
    const signals: AbortSignal[] = []
    mocks.ensure.mockImplementation(
      (_boardId: string, _generationUid: string, _recreate: boolean, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise(() => undefined)
      },
    )

    await render(generation("generation-hanging"))
    expect(mocks.ensure).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(AUTOMATIC_ENSURE_DEADLINE_MS))

    expect(signals[0]?.aborted).toBe(true)
    expect(latest?.error).toBe("안전한 결과 노드 오류")

    act(() => root.unmount())
    root = createRoot(container)
    await render(generation("generation-hanging"))
    expect(mocks.ensure).toHaveBeenCalledTimes(2)
  })


  it("rejects a mismatched board response before trusting its canonical ID", async () => {
    mocks.ensure.mockResolvedValueOnce(successfulOutcome("different-generation"))

    await render(generation("generation-response-check"))

    expect(latest?.outputNodeUid).toBeNull()
    expect(latest?.error).toBe("이미지 결과 노드 응답을 확인할 수 없습니다.")
    expect(mocks.refresh).not.toHaveBeenCalled()
  })


  it("uses recreate true only for an explicit editor recovery action", async () => {
    mocks.ensure.mockResolvedValueOnce({
      ...successfulOutcome("generation-restore"),
      created: true,
      recreated: true,
    })
    await render(generation("generation-restore", { output_node_uid: OUTPUT_NODE_UID }))

    await act(async () => {
      await latest?.recreate()
    })

    expect(mocks.ensure).toHaveBeenCalledTimes(1)
    expect(mocks.ensure).toHaveBeenCalledWith(
      BOARD_ID,
      "generation-restore",
      true,
      expect.any(AbortSignal),
    )
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })


  it("aborts a hanging recreate, unlocks, and permits a same-generation retry", async () => {
    const signals: AbortSignal[] = []
    mocks.ensure.mockImplementation(
      (_boardId: string, generationUid: string, recreate: boolean, signal: AbortSignal) => {
        signals.push(signal)
        if (signals.length === 1) return new Promise(() => undefined)
        return Promise.resolve({
          ...successfulOutcome(generationUid),
          created: recreate,
          recreated: recreate,
        })
      },
    )
    await render(generation("generation-recreate-timeout", {
      output_node_uid: OUTPUT_NODE_UID,
    }))

    let timedOutRequest: Promise<void> | undefined
    act(() => {
      timedOutRequest = latest?.recreate()
    })
    expect(latest?.recreating).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(EXPLICIT_RECREATE_DEADLINE_MS))
    await act(async () => {
      await timedOutRequest
    })

    expect(signals[0]?.aborted).toBe(true)
    expect(latest?.recreating).toBe(false)
    expect(latest?.error).toBe("안전한 결과 노드 오류")
    expect(mocks.refresh).not.toHaveBeenCalled()

    await act(async () => {
      await latest?.recreate()
    })
    expect(mocks.ensure).toHaveBeenCalledTimes(2)
    expect(signals[1]?.aborted).toBe(false)
    expect(latest?.recreating).toBe(false)
    expect(latest?.error).toBeNull()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })


  it("aborts an explicit recreate on unmount without surfacing a stale error", async () => {
    let signal: AbortSignal | null = null
    mocks.ensure.mockImplementation(
      (_boardId: string, _generationUid: string, _recreate: boolean, requestSignal: AbortSignal) => {
        signal = requestSignal
        return new Promise(() => undefined)
      },
    )
    await render(generation("generation-recreate-unmount", {
      output_node_uid: OUTPUT_NODE_UID,
    }))

    act(() => {
      void latest?.recreate()
    })
    expect(latest?.recreating).toBe(true)
    act(() => root.unmount())

    expect((signal as AbortSignal | null)?.aborted).toBe(true)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })


  it("aborts and ignores a late recreate response after generation replacement", async () => {
    let resolveOld: ((value: ReturnType<typeof successfulOutcome>) => void) | null = null
    mocks.ensure.mockImplementation(
      (_boardId: string, generationUid: string, recreate: boolean) => {
        if (generationUid === "generation-old" && recreate) {
          return new Promise((resolve) => { resolveOld = resolve })
        }
        return Promise.resolve(successfulOutcome(generationUid))
      },
    )
    await render(generation("generation-old", { output_node_uid: OUTPUT_NODE_UID }))

    let pending: Promise<void> | undefined
    act(() => {
      pending = latest?.recreate()
    })
    await render(generation("generation-new", { output_node_uid: "c".repeat(32) }))
    const oldSignal = mocks.ensure.mock.calls[0]?.[3] as AbortSignal
    expect(oldSignal.aborted).toBe(true)

    await act(async () => {
      resolveOld?.(successfulOutcome("generation-old"))
      await pending
    })

    expect(latest?.outputNodeUid).toBe("c".repeat(32))
    expect(latest?.error).toBeNull()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(latest?.recreating).toBe(false)
  })
})
