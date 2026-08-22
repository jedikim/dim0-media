import { useCallback, useEffect, useRef, useState } from "react"
import { v4 as uuidv4 } from "uuid"

import {
  NON_TERMINAL_IMAGE_STATUSES,
  getImageGeneration,
  imageGenerationErrorMessage,
  imageGenerationStatusCode,
  startImageGeneration,
  type GenerationParameters,
  type GenerationState,
} from "@/features/board/api/image-generation"
import {
  PENDING_IMAGE_REQUEST_VERSION,
  isOwnedPendingImageRequest,
  type PendingImageRequest,
} from "./node-state"


const FIRST_POLL_DELAY_MS = 1_000
const MAX_POLL_DELAY_MS = 5_000
const POLL_BACKOFF = 1.5
export const IMAGE_GENERATION_POLL_CEILING_MS = 5 * 60 * 1_000


const SAFE_TO_CLEAR_PENDING_STATUSES = new Set([400, 401, 403, 404, 422, 429])


export type ImageGenerationPhase =
  | "idle"
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "stalled"


export type PersistImageGenerationPatch = {
  activeGenerationUid?: string | null
  pendingRequest?: PendingImageRequest | null
}


export type UseImageGenerationArgs = {
  graphId: string
  nodeId: string
  userId: string
  activeGenerationUid: string | null
  pendingRequest: PendingImageRequest | null
  canStart: boolean
  persist: (patch: PersistImageGenerationPatch) => void
}


/** Own image-generation POST recovery, status polling, and terminal UI state. */
export function useImageGeneration(args: UseImageGenerationArgs) {
  const {
    graphId,
    nodeId,
    userId,
    activeGenerationUid,
    pendingRequest,
    canStart,
    persist,
  } = args
  const [phase, setPhase] = useState<ImageGenerationPhase>(
    activeGenerationUid ? "running" : "idle",
  )
  const [state, setState] = useState<GenerationState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasPendingRequest, setHasPendingRequest] = useState(pendingRequest !== null)
  const [pollRevision, setPollRevision] = useState(0)

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollControllerRef = useRef<AbortController | null>(null)
  const postControllerRef = useRef<AbortController | null>(null)
  const postingRef = useRef(false)
  const mountedRef = useRef(true)
  const pendingRef = useRef(pendingRequest)
  const recoveredRequestRef = useRef<string | null>(null)
  const persistRef = useRef(persist)
  persistRef.current = persist

  useEffect(() => {
    pendingRef.current = pendingRequest
    setHasPendingRequest(pendingRequest !== null)
  }, [pendingRequest])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    pollControllerRef.current?.abort()
    pollControllerRef.current = null
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopPolling()
      postControllerRef.current?.abort()
      postControllerRef.current = null
    }
  }, [stopPolling])

  useEffect(() => {
    stopPolling()
    if (!activeGenerationUid) {
      setState(null)
      if (!postingRef.current && !pendingRef.current) {
        setPhase("idle")
      }
      return
    }

    let alive = true
    let delay = 0
    const deadline = Date.now() + IMAGE_GENERATION_POLL_CEILING_MS
    const pendingOwnsPhase = (): boolean => pendingRef.current !== null

    const scheduleNext = (): void => {
      if (!alive) return
      if (Date.now() >= deadline) {
        if (!pendingOwnsPhase()) {
          setPhase("stalled")
          setError("이미지 생성 상태 확인이 오래 걸리고 있습니다. 상태를 다시 확인해 주세요.")
        }
        return
      }
      delay = delay === 0
        ? FIRST_POLL_DELAY_MS
        : Math.min(delay * POLL_BACKOFF, MAX_POLL_DELAY_MS)
      pollTimerRef.current = setTimeout(
        () => void tick(),
        Math.min(delay, Math.max(0, deadline - Date.now())),
      )
    }

    const tick = async (): Promise<void> => {
      const controller = new AbortController()
      pollControllerRef.current = controller
      try {
        const next = await getImageGeneration(graphId, activeGenerationUid, controller.signal)
        if (!alive || controller.signal.aborted) return
        setState(next)

        if (NON_TERMINAL_IMAGE_STATUSES.has(next.status)) {
          if (!pendingOwnsPhase()) {
            setPhase("running")
            setError(null)
          }
          scheduleNext()
          return
        }

        // An active handle identifies only the last server-confirmed run. A
        // simultaneous pending snapshot belongs to a newer POST and polling
        // cannot prove any relationship between them, so this path is read-only
        // while pending exists.
        if (pendingOwnsPhase()) return
        if (next.status === "succeeded") {
          setPhase("succeeded")
          setError(null)
        } else {
          setPhase("failed")
          setError(next.error_message || "이미지 생성에 실패했습니다.")
        }
      } catch (caught) {
        if (
          !alive
          || controller.signal.aborted
          || (caught instanceof Error && caught.name === "AbortError")
        ) return
        if (imageGenerationStatusCode(caught) === 404) {
          persistRef.current({ activeGenerationUid: null })
          setState(null)
          if (!pendingOwnsPhase()) {
            setPhase("idle")
            setError("이 보드에서는 기존 이미지 생성 기록을 불러올 수 없습니다.")
          }
          return
        }

        // A status transport failure is not a terminal provider failure. Keep
        // the active generation locked and continue checking within the cap.
        if (!pendingOwnsPhase()) {
          setPhase("running")
          setError(imageGenerationErrorMessage(caught))
        }
        scheduleNext()
      }
    }

    if (!pendingOwnsPhase()) {
      setPhase("running")
      setError(null)
    }
    void tick()
    return () => {
      alive = false
      stopPolling()
    }
  }, [activeGenerationUid, graphId, pollRevision, stopPolling])

  const sendPendingRequest = useCallback(async (snapshot: PendingImageRequest): Promise<void> => {
    if (postingRef.current || !canStart) return
    postingRef.current = true
    stopPolling()
    const controller = new AbortController()
    postControllerRef.current = controller
    setPhase("starting")
    setError(null)

    try {
      const accepted = await startImageGeneration({
        graphId,
        clientRequestUid: snapshot.clientRequestUid,
        modelId: snapshot.modelId,
        prompt: snapshot.prompt,
        parameters: snapshot.parameters,
        referenceAssetUids: [],
        generatorNodeUid: nodeId,
        signal: controller.signal,
      })
      if (!mountedRef.current) return
      pendingRef.current = null
      setHasPendingRequest(false)
      persistRef.current({
        activeGenerationUid: accepted.generation_uid,
        pendingRequest: null,
      })
      setPhase("running")
      setError(null)
    } catch (caught) {
      if (!mountedRef.current || (caught instanceof Error && caught.name === "AbortError")) return
      const status = imageGenerationStatusCode(caught)
      if (status === 409) {
        pendingRef.current = null
        setHasPendingRequest(false)
        persistRef.current({ pendingRequest: null })
        setPhase("failed")
        setError("요청 식별자가 다른 내용에 이미 사용되었습니다. 다시 생성해 주세요.")
        return
      }
      if (status !== null && SAFE_TO_CLEAR_PENDING_STATUSES.has(status)) {
        pendingRef.current = null
        setHasPendingRequest(false)
        persistRef.current({ pendingRequest: null })
      }
      // Transport and 5xx outcomes are ambiguous: the server may have started
      // and charged the request, so retain the exact snapshot for explicit
      // same-UUID recovery.
      setPhase("failed")
      setError(imageGenerationErrorMessage(caught))
    } finally {
      if (postControllerRef.current === controller) postControllerRef.current = null
      postingRef.current = false
    }
  }, [canStart, graphId, nodeId, stopPolling])

  useEffect(() => {
    if (!pendingRequest) return
    // A pending snapshot is shared node data but idempotency is scoped to the
    // authenticated user. Never replay or clear another user's recovery key.
    if (pendingRequest.initiatorUserUid !== userId) return
    if (!isOwnedPendingImageRequest(pendingRequest, graphId, nodeId, userId)) {
      if (canStart) {
        pendingRef.current = null
        setHasPendingRequest(false)
        persistRef.current({ pendingRequest: null })
      }
      return
    }
    if (!canStart || recoveredRequestRef.current === pendingRequest.clientRequestUid) return

    recoveredRequestRef.current = pendingRequest.clientRequestUid
    void sendPendingRequest(pendingRequest)
  }, [canStart, graphId, nodeId, pendingRequest, sendPendingRequest, userId])

  const generate = useCallback(async (
    modelId: string,
    prompt: string,
    parameters: GenerationParameters,
  ): Promise<void> => {
    if (!canStart || postingRef.current || pendingRef.current) return
    if (activeGenerationUid && phase !== "succeeded" && phase !== "failed") return

    stopPolling()
    const snapshot: PendingImageRequest = {
      version: PENDING_IMAGE_REQUEST_VERSION,
      boardUid: graphId,
      generatorNodeUid: nodeId,
      initiatorUserUid: userId,
      clientRequestUid: uuidv4(),
      modelId,
      prompt,
      parameters,
    }
    recoveredRequestRef.current = snapshot.clientRequestUid
    pendingRef.current = snapshot
    setHasPendingRequest(true)
    setPhase("starting")
    setError(null)
    // Preserve the last confirmed result while the new POST is indeterminate.
    // Only a 202 response is allowed to replace activeGenerationUid.
    persistRef.current({ pendingRequest: snapshot })
    await sendPendingRequest(snapshot)
  }, [activeGenerationUid, canStart, graphId, nodeId, phase, sendPendingRequest, stopPolling, userId])

  const resumePending = useCallback(async (): Promise<void> => {
    const snapshot = pendingRef.current
    if (!snapshot || !isOwnedPendingImageRequest(snapshot, graphId, nodeId, userId)) return
    await sendPendingRequest(snapshot)
  }, [graphId, nodeId, sendPendingRequest, userId])

  const checkStatusAgain = useCallback((): void => {
    if (!activeGenerationUid || phase !== "stalled" || pendingRef.current) return
    stopPolling()
    setPollRevision((revision) => revision + 1)
  }, [activeGenerationUid, phase, stopPolling])

  const canResumePending = isOwnedPendingImageRequest(
    hasPendingRequest ? pendingRef.current : null,
    graphId,
    nodeId,
    userId,
  )

  return {
    phase,
    state,
    error,
    generate,
    resumePending,
    checkStatusAgain,
    hasPendingRequest,
    canResumePending,
  }
}
