import { useCallback, useEffect, useRef, useState } from "react"
import { v4 as uuidv4 } from "uuid"

import {
  NON_TERMINAL_IMAGE_STATUSES,
  getImageGeneration,
  imageGenerationErrorDetail,
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
import { ImageReferenceResolutionError } from "../../image-reference-resolution"
import { IMAGE_REFERENCE_CHANGED_MESSAGE } from "../../image-reference-assets"


const FIRST_POLL_DELAY_MS = 1_000
const MAX_POLL_DELAY_MS = 5_000
const POLL_BACKOFF = 1.5
export const IMAGE_GENERATION_POLL_CEILING_MS = 5 * 60 * 1_000


const SAFE_TO_CLEAR_PENDING_STATUSES = new Set([400, 401, 403, 404, 422, 429])
const DETERMINATE_REFERENCE_REJECTION_CODES = new Set([
  "reference_too_large",
  "reference_pixel_limit_exceeded",
  "reference_request_too_large",
  "reference_encoded_size_exceeded",
])


export type ImageGenerationPhase =
  | "idle"
  | "resolving"
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
  resolveReferenceAssets?: (
    sourceNodeUids: readonly string[],
    signal: AbortSignal,
  ) => Promise<string[]>
  getCurrentReferenceSourceNodeUids?: () => string[]
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
    resolveReferenceAssets,
    getCurrentReferenceSourceNodeUids,
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
  const previewControllerRef = useRef<AbortController | null>(null)
  const resolvingControllerRef = useRef<AbortController | null>(null)
  const postingRef = useRef(false)
  const resolvingRef = useRef(false)
  const mountedRef = useRef(true)
  const activeGenerationUidRef = useRef(activeGenerationUid)
  const pendingRef = useRef(pendingRequest)
  const recoveredRequestRef = useRef<string | null>(null)
  const persistRef = useRef(persist)
  persistRef.current = persist
  activeGenerationUidRef.current = activeGenerationUid

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
      previewControllerRef.current?.abort()
      previewControllerRef.current = null
      resolvingControllerRef.current?.abort()
      resolvingControllerRef.current = null
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
          if (canStart) persistRef.current({ activeGenerationUid: null })
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
  }, [activeGenerationUid, canStart, graphId, pollRevision, stopPolling])

  /** Restore only the last confirmed preview after a pending POST fails. */
  const restoreActivePreview = useCallback(async (): Promise<void> => {
    const generationUid = activeGenerationUidRef.current
    if (!generationUid) return

    previewControllerRef.current?.abort()
    const controller = new AbortController()
    previewControllerRef.current = controller
    try {
      const previous = await getImageGeneration(graphId, generationUid, controller.signal)
      if (
        !mountedRef.current
        || controller.signal.aborted
        || activeGenerationUidRef.current !== generationUid
      ) return
      setState(previous)
    } catch {
      // Preview restoration is read-only and must not replace the POST error.
    } finally {
      if (previewControllerRef.current === controller) previewControllerRef.current = null
    }
  }, [graphId])

  const sendPendingRequest = useCallback(async (snapshot: PendingImageRequest): Promise<void> => {
    if (postingRef.current || !canStart) return
    postingRef.current = true
    stopPolling()
    previewControllerRef.current?.abort()
    previewControllerRef.current = null
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
        referenceAssetUids: snapshot.referenceAssetUids,
        generatorNodeUid: nodeId,
        signal: controller.signal,
      })
      if (!mountedRef.current) return
      activeGenerationUidRef.current = accepted.generation_uid
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
        void restoreActivePreview()
        return
      }
      const detail = imageGenerationErrorDetail(caught)
      const determinateReferenceRejection = status === 413
        && detail !== null
        && DETERMINATE_REFERENCE_REJECTION_CODES.has(detail.code)
      if (
        determinateReferenceRejection
        || (status !== null && SAFE_TO_CLEAR_PENDING_STATUSES.has(status))
      ) {
        pendingRef.current = null
        setHasPendingRequest(false)
        persistRef.current({ pendingRequest: null })
      }
      // Transport and 5xx outcomes are ambiguous: the server may have started
      // and charged the request, so retain the exact snapshot for explicit
      // same-UUID recovery.
      setPhase("failed")
      setError(imageGenerationErrorMessage(caught))
      void restoreActivePreview()
    } finally {
      if (postControllerRef.current === controller) postControllerRef.current = null
      postingRef.current = false
    }
  }, [canStart, graphId, nodeId, restoreActivePreview, stopPolling])

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

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || recoveredRequestRef.current === pendingRequest.clientRequestUid) return
      recoveredRequestRef.current = pendingRequest.clientRequestUid
      void sendPendingRequest(pendingRequest)
    })
    return () => {
      cancelled = true
    }
  }, [canStart, graphId, nodeId, pendingRequest, sendPendingRequest, userId])

  const generate = useCallback(async (
    modelId: string,
    prompt: string,
    parameters: GenerationParameters,
    referenceSourceNodeUids: string[] = [],
  ): Promise<void> => {
    if (!canStart || postingRef.current || resolvingRef.current || pendingRef.current) return
    if (activeGenerationUid && phase !== "succeeded" && phase !== "failed") return

    stopPolling()
    let referenceAssetUids: string[] = []
    if (referenceSourceNodeUids.length > 0) {
      resolvingRef.current = true
      const controller = new AbortController()
      resolvingControllerRef.current = controller
      setPhase("resolving")
      setError(null)
      try {
        if (!resolveReferenceAssets) {
          throw new ImageReferenceResolutionError("참조 이미지를 확인할 수 없습니다.")
        }
        referenceAssetUids = await resolveReferenceAssets(referenceSourceNodeUids, controller.signal)
        if (!mountedRef.current || controller.signal.aborted) return
        if (referenceAssetUids.length !== referenceSourceNodeUids.length) {
          throw new ImageReferenceResolutionError("참조 이미지 순서를 확인할 수 없습니다.")
        }
        const currentSourceNodeUids = getCurrentReferenceSourceNodeUids?.()
        if (
          currentSourceNodeUids
          && (
            currentSourceNodeUids.length !== referenceSourceNodeUids.length
            || currentSourceNodeUids.some((uid, index) => uid !== referenceSourceNodeUids[index])
          )
        ) {
          throw new ImageReferenceResolutionError(IMAGE_REFERENCE_CHANGED_MESSAGE)
        }
      } catch (caught) {
        if (!mountedRef.current || (caught instanceof Error && caught.name === "AbortError")) return
        setPhase("failed")
        setError(
          caught instanceof ImageReferenceResolutionError
            ? caught.message
            : imageGenerationErrorMessage(caught),
        )
        void restoreActivePreview()
        return
      } finally {
        if (resolvingControllerRef.current === controller) resolvingControllerRef.current = null
        resolvingRef.current = false
      }
    }

    const snapshot: PendingImageRequest = {
      version: PENDING_IMAGE_REQUEST_VERSION,
      boardUid: graphId,
      generatorNodeUid: nodeId,
      initiatorUserUid: userId,
      clientRequestUid: uuidv4(),
      modelId,
      prompt,
      parameters,
      referenceSourceNodeUids: [...referenceSourceNodeUids],
      referenceAssetUids: [...referenceAssetUids],
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
  }, [
    activeGenerationUid,
    canStart,
    graphId,
    getCurrentReferenceSourceNodeUids,
    nodeId,
    phase,
    resolveReferenceAssets,
    restoreActivePreview,
    sendPendingRequest,
    stopPolling,
    userId,
  ])

  const resumePending = useCallback(async (): Promise<void> => {
    const snapshot = pendingRef.current
    if (!snapshot || !isOwnedPendingImageRequest(snapshot, graphId, nodeId, userId)) return
    await sendPendingRequest(snapshot)
  }, [graphId, nodeId, sendPendingRequest, userId])

  const refreshStatus = useCallback((): void => {
    if (!activeGenerationUid || pendingRef.current) return
    stopPolling()
    setPollRevision((revision) => revision + 1)
  }, [activeGenerationUid, stopPolling])

  const checkStatusAgain = useCallback((): void => {
    if (phase !== "stalled") return
    refreshStatus()
  }, [phase, refreshStatus])

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
    refreshStatus,
    hasPendingRequest,
    canResumePending,
  }
}
