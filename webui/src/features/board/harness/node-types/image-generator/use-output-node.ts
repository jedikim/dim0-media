import { useCallback, useEffect, useRef, useState } from "react"
import { asNodeId, type CanvasStore } from "@canvas-harness/core"

import {
  ensureImageGenerationOutputNode,
  imageGenerationErrorMessage,
  imageGenerationStatusCode,
  type GenerationOutputNode,
  type GenerationState,
} from "@/features/board/api/image-generation"


const OUTPUT_NODE_UID_PATTERN = /^[0-9a-f]{32}$/
const AUTOMATIC_ENSURE_ATTEMPTS = 3
const AUTOMATIC_ENSURE_RETRY_MS = 250
const AUTOMATIC_ENSURE_CACHE_MS = 30_000
export const AUTOMATIC_ENSURE_DEADLINE_MS = 30_000
export const EXPLICIT_RECREATE_DEADLINE_MS = 30_000

type AutomaticEnsureEntry = {
  promise: Promise<GenerationOutputNode>
  controller: AbortController
  deadlineTimer: ReturnType<typeof setTimeout>
  cacheTimer: ReturnType<typeof setTimeout> | null
}

// Follow-up: move this cache and image-reference-edges' lockedReferenceTargets
// into a board-scoped lifecycle owner instead of keeping module-global state.
const automaticEnsures = new Map<string, AutomaticEnsureEntry>()


/** Return whether an idempotent canvas PUT can be retried after response loss. */
function isTransientEnsureFailure(error: unknown): boolean {
  const status = imageGenerationStatusCode(error)
  return error instanceof TypeError
    || status === 408
    || status === 429
    || (status !== null && status >= 500)
}


/** Validate one board-scoped output association before trusting its node ID. */
function isExpectedOutput(
  outcome: GenerationOutputNode,
  generationUid: string,
  outputAssetUid: string | null,
): boolean {
  return outcome.generation_uid === generationUid
    && outcome.output_asset_uid === outputAssetUid
    && OUTPUT_NODE_UID_PATTERN.test(outcome.output_node_uid)
}


/** Wait for one retry delay, rejecting immediately when the request is aborted. */
function waitForEnsureRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException("Image result request aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}


/** Remove one shared ensure and release every timer/request it owns. */
function removeAutomaticEnsure(key: string, abort: boolean): void {
  const entry = automaticEnsures.get(key)
  if (!entry) return
  automaticEnsures.delete(key)
  clearTimeout(entry.deadlineTimer)
  if (entry.cacheTimer !== null) clearTimeout(entry.cacheTimer)
  if (abort) entry.controller.abort()
}


/** Share one bounded automatic ensure across StrictMode/remount observers. */
function automaticEnsure(graphId: string, generationUid: string): Promise<GenerationOutputNode> {
  const key = `${graphId}:${generationUid}`
  const existing = automaticEnsures.get(key)
  if (existing) return existing.promise
  const controller = new AbortController()

  const runAttempt = async (attempt: number): Promise<GenerationOutputNode> => {
    try {
      return await ensureImageGenerationOutputNode(
        graphId,
        generationUid,
        false,
        controller.signal,
      )
    } catch (error) {
      if (!isTransientEnsureFailure(error) || attempt >= AUTOMATIC_ENSURE_ATTEMPTS) {
        throw error
      }
      await waitForEnsureRetry(
        AUTOMATIC_ENSURE_RETRY_MS * (2 ** (attempt - 1)),
        controller.signal,
      )
      return runAttempt(attempt + 1)
    }
  }

  let rejectDeadline: (error: Error) => void = () => undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject
  })
  const request = Promise.race([runAttempt(1), deadline])
  const deadlineTimer = setTimeout(() => {
    rejectDeadline(new Error("Image result request deadline exceeded"))
    controller.abort()
  }, AUTOMATIC_ENSURE_DEADLINE_MS)
  const entry: AutomaticEnsureEntry = {
    promise: request,
    controller,
    deadlineTimer,
    cacheTimer: null,
  }
  automaticEnsures.set(key, entry)
  void request.then(
    () => {
      clearTimeout(deadlineTimer)
      entry.cacheTimer = setTimeout(() => {
        if (automaticEnsures.get(key) === entry) removeAutomaticEnsure(key, false)
      }, AUTOMATIC_ENSURE_CACHE_MS)
    },
    () => {
      if (automaticEnsures.get(key) === entry) removeAutomaticEnsure(key, true)
    },
  )
  return request
}


/** Own automatic materialization and explicit deleted-result restoration. */
export function useImageGenerationOutputNode(args: {
  graphId: string
  generation: GenerationState | null
  canEdit: boolean
  store: CanvasStore
  refreshStatus: () => void
}) {
  const { graphId, generation, canEdit, store, refreshStatus } = args
  const generationUid = generation?.generation_uid ?? null
  const serverOutputNodeUid = generation?.output_node_uid ?? null
  const outputAssetUid = generation?.output_asset_uid ?? null
  const [ensuredOutputNodeUid, setEnsuredOutputNodeUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recreating, setRecreating] = useState(false)
  const recreateRequest = useRef<{ token: symbol; controller: AbortController } | null>(null)
  const outputNodeUid = serverOutputNodeUid ?? ensuredOutputNodeUid
  const [nodePresent, setNodePresent] = useState(false)

  useEffect(() => {
    recreateRequest.current?.controller.abort()
    recreateRequest.current = null
    setEnsuredOutputNodeUid(null)
    setError(null)
    setRecreating(false)
  }, [generationUid])

  useEffect(() => () => {
    recreateRequest.current?.controller.abort()
    recreateRequest.current = null
  }, [])

  useEffect(() => {
    if (generationUid && serverOutputNodeUid) {
      removeAutomaticEnsure(`${graphId}:${generationUid}`, true)
    }
  }, [generationUid, graphId, serverOutputNodeUid])

  useEffect(() => {
    const updatePresence = (): void => {
      const node = outputNodeUid ? store.getNode(asNodeId(outputNodeUid)) : null
      setNodePresent(node?.type === "generated-image")
    }
    updatePresence()
    return store.subscribe("change", (batch) => {
      if (!outputNodeUid) return
      const changed = batch.ops.some((op) => (
        (op.type === "node.add" || op.type === "node.remove")
        && op.node.id === outputNodeUid
      ))
      if (changed) updatePresence()
    })
  }, [outputNodeUid, store])

  useEffect(() => {
    if (
      !canEdit
      || generation?.status !== "succeeded"
      || !generationUid
      || serverOutputNodeUid
    ) return
    let alive = true
    void automaticEnsure(graphId, generationUid)
      .then((outcome) => {
        if (!alive) return
        if (!isExpectedOutput(outcome, generationUid, outputAssetUid)) {
          setError("이미지 결과 노드 응답을 확인할 수 없습니다.")
          return
        }
        setEnsuredOutputNodeUid(outcome.output_node_uid)
        setError(null)
        refreshStatus()
      })
      .catch((caught: unknown) => {
        if (!alive) return
        setError(imageGenerationErrorMessage(caught))
      })
    return () => {
      alive = false
    }
  }, [canEdit, generation?.status, generationUid, graphId, outputAssetUid, refreshStatus, serverOutputNodeUid])

  const selectResult = useCallback((): void => {
    if (!outputNodeUid) return
    const nodeId = asNodeId(outputNodeUid)
    if (store.getNode(nodeId)?.type === "generated-image") {
      store.setSelection([nodeId])
    }
  }, [outputNodeUid, store])

  const recreate = useCallback(async (): Promise<void> => {
    if (!canEdit || generation?.status !== "succeeded" || !generationUid || recreating) return
    const token = Symbol(generationUid)
    const controller = new AbortController()
    recreateRequest.current = { token, controller }
    setRecreating(true)
    setError(null)
    let timedOut = false
    let rejectDeadline: (error: Error) => void = () => undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject
    })
    const deadlineTimer = setTimeout(() => {
      timedOut = true
      rejectDeadline(new Error("Image result recreation deadline exceeded"))
      controller.abort()
    }, EXPLICIT_RECREATE_DEADLINE_MS)
    try {
      const outcome = await Promise.race([
        ensureImageGenerationOutputNode(
          graphId,
          generationUid,
          true,
          controller.signal,
        ),
        deadline,
      ])
      if (recreateRequest.current?.token !== token || controller.signal.aborted) return
      if (!isExpectedOutput(outcome, generationUid, outputAssetUid)) {
        throw new Error("invalid output node response")
      }
      setEnsuredOutputNodeUid(outcome.output_node_uid)
      refreshStatus()
    } catch (caught) {
      if (
        recreateRequest.current?.token !== token
        || (controller.signal.aborted && !timedOut)
      ) return
      setError(imageGenerationErrorMessage(caught))
    } finally {
      clearTimeout(deadlineTimer)
      if (recreateRequest.current?.token === token) {
        recreateRequest.current = null
        setRecreating(false)
      }
    }
  }, [canEdit, generation?.status, generationUid, graphId, outputAssetUid, recreating, refreshStatus])

  return {
    outputNodeUid,
    nodePresent,
    selectResult,
    recreate,
    recreating,
    error,
  }
}
