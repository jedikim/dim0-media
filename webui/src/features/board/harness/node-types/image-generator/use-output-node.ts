import { useCallback, useEffect, useState } from "react"
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
const automaticEnsures = new Map<string, Promise<GenerationOutputNode>>()


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


/** Share one bounded automatic ensure across StrictMode/remount observers. */
function automaticEnsure(graphId: string, generationUid: string): Promise<GenerationOutputNode> {
  const key = `${graphId}:${generationUid}`
  const existing = automaticEnsures.get(key)
  if (existing) return existing
  const request = (async (): Promise<GenerationOutputNode> => {
    for (let attempt = 1; attempt <= AUTOMATIC_ENSURE_ATTEMPTS; attempt += 1) {
      try {
        return await ensureImageGenerationOutputNode(graphId, generationUid, false)
      } catch (error) {
        if (!isTransientEnsureFailure(error) || attempt === AUTOMATIC_ENSURE_ATTEMPTS) {
          automaticEnsures.delete(key)
          throw error
        }
        await new Promise((resolve) => {
          setTimeout(resolve, AUTOMATIC_ENSURE_RETRY_MS * (2 ** (attempt - 1)))
        })
      }
    }
    throw new Error("automatic output-node retry exhausted")
  })()
  automaticEnsures.set(key, request)
  void request.then(
    () => {
      setTimeout(() => {
        if (automaticEnsures.get(key) === request) automaticEnsures.delete(key)
      }, AUTOMATIC_ENSURE_CACHE_MS)
    },
    () => undefined,
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
  const outputNodeUid = serverOutputNodeUid ?? ensuredOutputNodeUid
  const [nodePresent, setNodePresent] = useState(false)

  useEffect(() => {
    setEnsuredOutputNodeUid(null)
    setError(null)
  }, [generationUid])

  useEffect(() => {
    if (generationUid && serverOutputNodeUid) {
      automaticEnsures.delete(`${graphId}:${generationUid}`)
    }
  }, [generationUid, graphId, serverOutputNodeUid])

  useEffect(() => {
    const updatePresence = (): void => {
      const node = outputNodeUid ? store.getNode(asNodeId(outputNodeUid)) : null
      setNodePresent(node?.type === "generated-image")
    }
    updatePresence()
    return store.subscribe("change", updatePresence)
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
    setRecreating(true)
    setError(null)
    try {
      const outcome = await ensureImageGenerationOutputNode(graphId, generationUid, true)
      if (!isExpectedOutput(outcome, generationUid, outputAssetUid)) {
        throw new Error("invalid output node response")
      }
      setEnsuredOutputNodeUid(outcome.output_node_uid)
      refreshStatus()
    } catch (caught) {
      setError(imageGenerationErrorMessage(caught))
    } finally {
      setRecreating(false)
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
