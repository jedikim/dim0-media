import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { NodeId } from "@canvas-harness/core"
import { useCanvasStore, useNode } from "@canvas-harness/react"
import { Plus, X } from "@phosphor-icons/react"
import { toast } from "sonner"

import { ImageStackIcon } from "@/components/icons"
import {
  imageGenerationErrorMessage,
  imageGenerationStatusCode,
  getImageGeneration,
  listImageModels,
  type GenerationParameters,
  type ImageModel,
} from "@/features/board/api/image-generation"
import { removeNodeSubtree } from "@/features/board/harness/graph/subtree"
import { useAuthedImage } from "@/features/board/hooks/use-authed-image"
import type { NoteProperties } from "@/features/board/types/note"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store"
import { useBoardRuntime } from "../../canvas/board-runtime-context"
import { useHarnessAddImage } from "../../canvas/use-add-image"
import type { NoteNodeData } from "../../convert/note-to-node"
import {
  addImageReferenceEdge,
  orderedImageReferences,
  useImageReferenceTargetLock,
  useOrderedImageReferences,
} from "../../image-reference-edges"
import { resolveReferenceAssetUids } from "../../image-reference-resolution"
import {
  NodeFooter,
  NodeTitleCaption,
  NodeTrafficLights,
  useStopCanvasGesture,
} from "../../shared-views"
import { useBoardAppStore } from "../../store/board-app-store"
import {
  CLEARED_ACTIVE_GENERATION_UID,
  CLEARED_IMAGE_PENDING_REQUEST,
  internalTextProperty,
  keywordProperty,
  parsePendingImageRequest,
  readKeywordProperty,
  readTextProperty,
  serializePendingImageRequest,
} from "./node-state"
import {
  useImageGeneration,
  type PersistImageGenerationPatch,
} from "./use-image-generation"
import { useImageGenerationOutputNode } from "./use-output-node"
import { readGeneratedImageAssociation } from "../generated-image/node-state"


const SELECT_CLASS =
  "h-8 min-w-0 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"


const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-50"


export const IMAGE_PROMPT_DEBOUNCE_MS = 400
const REFERENCE_THUMBNAIL_FIRST_POLL_MS = 1_000
const REFERENCE_THUMBNAIL_MAX_POLL_MS = 5_000
const REFERENCE_THUMBNAIL_POLL_CEILING_MS = 5 * 60 * 1_000


const isSupportedChoice = (value: string | null, choices: string[] | null): value is string =>
  value !== null && choices !== null && choices.includes(value)


/** Keep prompt typing local and flush the latest whole value at safe boundaries. */
function usePromptDraft(
  storedPrompt: string,
  persistPrompt: (prompt: string) => void,
  locked: boolean,
) {
  const [draft, setDraft] = useState(storedPrompt)
  const draftRef = useRef(storedPrompt)
  const storedPromptRef = useRef(storedPrompt)
  const editingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistPromptRef = useRef(persistPrompt)
  persistPromptRef.current = persistPrompt

  const clearTimer = useCallback((): void => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const commitPrompt = useCallback((): string => {
    clearTimer()
    const next = draftRef.current
    editingRef.current = false
    if (next !== storedPromptRef.current) {
      storedPromptRef.current = next
      persistPromptRef.current(next)
    }
    return next
  }, [clearTimer])

  useEffect(() => {
    storedPromptRef.current = storedPrompt
    if (editingRef.current) {
      if (storedPrompt === draftRef.current) editingRef.current = false
      return
    }
    if (storedPrompt !== draftRef.current) {
      draftRef.current = storedPrompt
      setDraft(storedPrompt)
    }
  }, [storedPrompt])

  useEffect(() => {
    if (!locked) return
    clearTimer()
    editingRef.current = false
    if (draftRef.current !== storedPromptRef.current) {
      draftRef.current = storedPromptRef.current
      setDraft(storedPromptRef.current)
    }
  }, [clearTimer, locked])

  useEffect(() => () => {
    if (editingRef.current) commitPrompt()
    else clearTimer()
  }, [clearTimer, commitPrompt])

  const updateDraft = useCallback((next: string): void => {
    draftRef.current = next
    editingRef.current = true
    setDraft(next)
    clearTimer()
    timerRef.current = setTimeout(commitPrompt, IMAGE_PROMPT_DEBOUNCE_MS)
  }, [clearTimer, commitPrompt])

  const flushForGenerate = useCallback((): string => {
    clearTimer()
    editingRef.current = false
    storedPromptRef.current = draftRef.current
    return draftRef.current
  }, [clearTimer])

  return { draft, updateDraft, commitPrompt, flushForGenerate }
}


/** Render one capability selector only when the server advertises values. */
function CapabilitySelect({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string
  value: string | null
  choices: string[] | null
  disabled: boolean
  onChange: (value: string) => void
}) {
  if (!choices || choices.length === 0) return null
  const selected = value && choices.includes(value) ? value : ""
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <select
        aria-label={label}
        className={SELECT_CLASS}
        value={selected}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">기본값</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>{choice}</option>
        ))}
      </select>
    </label>
  )
}


/** Convert hook phase into compact, non-authoritative UI copy. */
function phaseLabel(phase: ReturnType<typeof useImageGeneration>["phase"]): string {
  switch (phase) {
    case "resolving": return "참조 확인 중"
    case "starting": return "요청 저장 중"
    case "running": return "이미지 생성 중"
    case "succeeded": return "완료"
    case "failed": return "확인 필요"
    case "stalled": return "상태 확인 지연"
    default: return "준비됨"
  }
}


/** Load a generator source's latest successful output for a read-only thumbnail. */
function GeneratorReferenceThumbnail({
  graphId,
  generationUid,
}: {
  graphId: string
  generationUid: string | null
}) {
  const [resolved, setResolved] = useState<{
    generationUid: string
    assetUid: string
  } | null>(null)
  const generationUidRef = useRef(generationUid)
  generationUidRef.current = generationUid
  useEffect(() => {
    setResolved(null)
    if (!generationUid) {
      return
    }
    const controller = new AbortController()
    const requestedUid = generationUid
    const deadline = Date.now() + REFERENCE_THUMBNAIL_POLL_CEILING_MS
    let timer: ReturnType<typeof setTimeout> | null = null
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null
    let delay = 0
    let alive = true

    const clearPollingTimers = (): void => {
      if (timer) clearTimeout(timer)
      if (deadlineTimer) clearTimeout(deadlineTimer)
      timer = null
      deadlineTimer = null
    }

    deadlineTimer = setTimeout(() => {
      if (!alive) return
      clearPollingTimers()
      controller.abort()
    }, REFERENCE_THUMBNAIL_POLL_CEILING_MS)

    const scheduleNext = (): void => {
      const remaining = deadline - Date.now()
      if (!alive || controller.signal.aborted || remaining <= 0) {
        controller.abort()
        return
      }
      delay = delay === 0
        ? REFERENCE_THUMBNAIL_FIRST_POLL_MS
        : Math.min(delay * 1.5, REFERENCE_THUMBNAIL_MAX_POLL_MS)
      timer = setTimeout(() => void poll(), Math.min(delay, remaining))
    }

    const poll = async (): Promise<void> => {
      if (!alive || controller.signal.aborted || Date.now() >= deadline) {
        controller.abort()
        return
      }
      try {
        const generation = await getImageGeneration(graphId, requestedUid, controller.signal)
        if (!alive || controller.signal.aborted || generationUidRef.current !== requestedUid) return
        if (generation.status === "succeeded" && generation.output_asset_uid) {
          clearPollingTimers()
          setResolved({
            generationUid: requestedUid,
            assetUid: generation.output_asset_uid,
          })
          return
        }
        if (generation.status !== "started" && generation.status !== "retryable") {
          clearPollingTimers()
          return
        }
        scheduleNext()
      } catch (error) {
        if (
          !alive
          || controller.signal.aborted
          || (error instanceof Error && error.name === "AbortError")
        ) return
        const status = imageGenerationStatusCode(error)
        const transient = (
          error instanceof TypeError
          || status === 408
          || status === 429
          || (status !== null && status >= 500)
        )
        if (transient) scheduleNext()
        else clearPollingTimers()
        // Determinate client failures keep the source as a placeholder.
      }
    }

    void poll()
    return () => {
      alive = false
      controller.abort()
      clearPollingTimers()
    }
  }, [generationUid, graphId])
  const assetUid = resolved?.generationUid === generationUid ? resolved.assetUid : null
  const { url } = useAuthedImage(graphId, assetUid)
  return url
    ? <img className="size-full object-cover" src={url} alt="참조 생성 이미지" />
    : <ImageStackIcon className="size-4 text-muted-foreground" />
}


/** Render one live canvas source as a compact reference thumbnail. */
function ReferenceThumbnail({ graphId, sourceNodeId }: { graphId: string; sourceNodeId: NodeId }) {
  const source = useNode(sourceNodeId)
  const data = (source?.data ?? {}) as NoteNodeData & { src?: unknown }
  const generatedAssociation = source?.type === "generated-image"
    ? readGeneratedImageAssociation(data.properties ?? {})
    : null
  const { url: generatedUrl } = useAuthedImage(graphId, generatedAssociation?.assetUid ?? null)
  if (!source) return <ImageStackIcon className="size-4 text-muted-foreground" />
  if (source.type === "image" && typeof data.src === "string") {
    return <img className="size-full object-cover" src={data.src} alt="참조 이미지" />
  }
  if (source.type === "image-generator") {
    return (
      <GeneratorReferenceThumbnail
        graphId={graphId}
        generationUid={readKeywordProperty(data.properties?.activeGenerationUid)}
      />
    )
  }
  if (source.type === "generated-image" && generatedUrl) {
    return <img className="size-full object-cover" src={generatedUrl} alt="참조 생성 결과" />
  }
  return <ImageStackIcon className="size-4 text-muted-foreground" />
}


/** Render the synced-board form and all authenticated image network flows. */
function SyncedImageGeneratorCard({
  id,
  data,
  properties,
  canEdit,
  patchProperties,
}: {
  id: NodeId
  data: NoteNodeData
  properties: Partial<NoteProperties>
  canEdit: boolean
  patchProperties: (patch: Partial<NoteProperties>) => void
}) {
  const store = useCanvasStore()
  const graphId = data.graphUid
  const addImage = useHarnessAddImage(store, graphId, data.parentId ?? null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [addingReferences, setAddingReferences] = useState(false)
  const nodeId = String(id)
  const userId = useAppStore((state) => state.userId)
  const rawPendingRequest = readTextProperty(properties.imagePendingRequest)
  const pendingRequest = useMemo(
    () => parsePendingImageRequest(rawPendingRequest),
    [rawPendingRequest],
  )
  const references = useOrderedImageReferences(store, id)
  const referenceSourceNodeUids = useMemo(
    () => references.map((reference) => String(reference.sourceNodeId)),
    [references],
  )
  const getCurrentReferenceSourceNodeUids = useCallback(
    (): string[] => orderedImageReferences(store, id)
      .map((reference) => String(reference.sourceNodeId)),
    [id, store],
  )
  const resolveReferenceAssets = useCallback((
    sourceNodeUids: readonly string[],
    signal: AbortSignal,
  ): Promise<string[]> => resolveReferenceAssetUids({
    store,
    graphId,
    sourceNodeUids,
    signal,
    getCurrentSourceNodeUids: getCurrentReferenceSourceNodeUids,
  }), [getCurrentReferenceSourceNodeUids, graphId, store])

  const persist = useCallback((patch: PersistImageGenerationPatch): void => {
    const propertyPatch: Partial<NoteProperties> = {}
    if ("activeGenerationUid" in patch) {
      propertyPatch.activeGenerationUid = patch.activeGenerationUid
        ? keywordProperty(patch.activeGenerationUid)
        : CLEARED_ACTIVE_GENERATION_UID
    }
    if ("pendingRequest" in patch) {
      propertyPatch.imagePendingRequest = patch.pendingRequest
        ? internalTextProperty(serializePendingImageRequest(patch.pendingRequest))
        : CLEARED_IMAGE_PENDING_REQUEST
    }
    patchProperties(propertyPatch)
  }, [patchProperties])

  useEffect(() => {
    if (canEdit && rawPendingRequest && pendingRequest === null) {
      persist({ pendingRequest: null })
    }
  }, [canEdit, pendingRequest, persist, rawPendingRequest])

  const generation = useImageGeneration({
    graphId,
    nodeId,
    userId,
    activeGenerationUid: readKeywordProperty(properties.activeGenerationUid),
    pendingRequest,
    canStart: canEdit,
    persist,
    resolveReferenceAssets,
    getCurrentReferenceSourceNodeUids,
  })
  const outputNode = useImageGenerationOutputNode({
    graphId,
    generation: generation.state,
    canEdit,
    store,
    refreshStatus: generation.refreshStatus,
  })

  const [models, setModels] = useState<ImageModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelsError, setModelsError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void listImageModels()
      .then((next) => {
        if (!alive) return
        setModels(next)
        setModelsError(null)
      })
      .catch((error: unknown) => {
        if (!alive) return
        setModels([])
        setModelsError(imageGenerationErrorMessage(error))
      })
      .finally(() => {
        if (alive) setModelsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const busy = generation.phase === "resolving"
    || generation.phase === "starting"
    || generation.phase === "running"
    || generation.phase === "stalled"
    || outputNode.recreating
  const generationInputsLocked = !canEdit || busy || generation.hasPendingRequest
  const inputsLocked = generationInputsLocked || addingReferences
  useImageReferenceTargetLock(id, generationInputsLocked)

  const storedModelId = readKeywordProperty(properties.imageModelId)
  const hasReferences = references.length > 0
  const compatibleModels = useMemo(
    () => models.filter((candidate) => hasReferences
      ? candidate.supports_image_to_image
      : candidate.supports_text_to_image),
    [hasReferences, models],
  )
  const storedModel = useMemo(
    () => models.find((candidate) => candidate.model_id === storedModelId) ?? null,
    [models, storedModelId],
  )
  const storedModelUnavailable = !modelsLoading
    && !modelsError
    && storedModelId !== null
    && (hasReferences
      ? storedModel?.supports_image_to_image !== true
      : storedModel?.supports_text_to_image !== true)
  const model = storedModelId
    ? (hasReferences
        ? storedModel?.supports_image_to_image === true
        : storedModel?.supports_text_to_image === true)
      ? storedModel
      : null
    : compatibleModels[0] ?? null
  const globalReferenceLimit = useMemo(
    () => models.reduce(
      (maximum, candidate) => Math.max(maximum, candidate.max_reference_images),
      0,
    ),
    [models],
  )
  const referenceLimit = model?.max_reference_images ?? null
  const referenceOverflow = referenceLimit === null
    ? 0
    : Math.max(0, references.length - referenceLimit)
  const storedPrompt = readTextProperty(properties.imagePrompt)
  const persistPrompt = useCallback((next: string): void => {
    patchProperties({ imagePrompt: { type: "text", text: next } })
  }, [patchProperties])
  const prompt = usePromptDraft(storedPrompt, persistPrompt, generationInputsLocked)
  const aspectRatio = readKeywordProperty(properties.imageAspectRatio)
  const resolution = readKeywordProperty(properties.imageResolution)
  const quality = readKeywordProperty(properties.imageQuality)

  const parameters = useMemo<GenerationParameters>(() => ({
    ...(model && isSupportedChoice(aspectRatio, model.supported_aspect_ratios)
      ? { aspect_ratio: aspectRatio }
      : {}),
    ...(model && isSupportedChoice(resolution, model.supported_resolutions)
      ? { resolution }
      : {}),
    ...(model && isSupportedChoice(quality, model.supported_qualities)
      ? { quality }
      : {}),
  }), [aspectRatio, model, quality, resolution])

  const canGenerate = canEdit
    && !modelsLoading
    && !modelsError
    && (hasReferences ? model?.supports_image_to_image === true : model?.supports_text_to_image === true)
    && references.length <= (model?.max_reference_images ?? 0)
    && !storedModelUnavailable
    && prompt.draft.trim().length > 0
    && !inputsLocked
  const canAddReferences = canEdit
    && !generationInputsLocked
    && !addingReferences
    && globalReferenceLimit > 0
    && references.length < globalReferenceLimit

  const addReferenceFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    if (files.length === 0 || !canAddReferences) return
    const supportedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"])
    if (files.some((file) => !supportedMimeTypes.has(file.type))) {
      toast.error("PNG, JPEG 또는 WebP 이미지만 참조로 추가할 수 있습니다.")
      return
    }
    const available = globalReferenceLimit - orderedImageReferences(store, id).length
    if (files.length > available) {
      toast.error(`참조 이미지는 최대 ${globalReferenceLimit}장까지 추가할 수 있습니다.`)
      return
    }
    const generator = store.getNode(id)
    if (!generator) return

    setAddingReferences(true)
    let nextY = generator.y
    try {
      for (const file of files) {
        const sourceNodeId = await addImage(file, {
          resolvePosition: (size) => ({
            x: generator.x - size.width - 24,
            y: nextY,
          }),
        })
        if (!sourceNodeId) continue
        const source = store.getNode(sourceNodeId)
        if (!source) continue
        nextY += source.h + 16
        const edgeId = addImageReferenceEdge({
          store,
          sourceNodeId,
          targetNodeId: id,
          graphUid: graphId,
          parentId: data.parentId,
        })
        if (!edgeId) {
          toast.error(`"${file.name}" 이미지는 추가했지만 참조로 연결하지 못했습니다.`)
        }
      }
    } finally {
      setAddingReferences(false)
    }
  }, [addImage, canAddReferences, data.parentId, globalReferenceLimit, graphId, id, store])
  const footerStatus = generation.phase === "resolving"
    || generation.phase === "starting"
    || generation.phase === "running"
    ? "saving"
    : generation.phase === "succeeded"
    ? "saved"
    : generation.phase === "failed" || generation.phase === "stalled"
    ? "error"
    : "idle"

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 pt-0">
      <textarea
        aria-label="Image prompt"
        className={cn(INPUT_CLASS, "min-h-20 resize-none")}
        value={prompt.draft}
        disabled={inputsLocked}
        maxLength={32_000}
        placeholder="만들고 싶은 이미지를 설명하세요"
        onChange={(event) => prompt.updateDraft(event.target.value)}
        onBlur={() => prompt.commitPrompt()}
      />

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          참조 이미지 {references.length} / {referenceLimit ?? "—"}
          {referenceOverflow > 0 && (
            <span className="text-destructive"> · {referenceOverflow}장 초과</span>
          )}
        </span>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canAddReferences}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus className="size-3" />
          참조 이미지
        </button>
        <input
          ref={fileInputRef}
          aria-label="Add reference images"
          className="hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={!canAddReferences}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ""
            void addReferenceFiles(files)
          }}
        />
      </div>
      <div aria-label="Image references" className="flex min-h-20 gap-2 overflow-x-auto py-1">
        {references.map((reference, index) => (
          <div
            key={String(reference.edge.id)}
            className={cn(
              "relative size-20 shrink-0 overflow-hidden rounded-md border bg-muted/40",
              referenceLimit !== null && index >= referenceLimit
                ? "border-destructive"
                : "border-border",
            )}
          >
            <ReferenceThumbnail graphId={graphId} sourceNodeId={reference.sourceNodeId} />
            <span className="absolute bottom-0 left-0 rounded-tr bg-background/90 px-1 text-[10px] font-semibold">
              {index + 1}
            </span>
            <button
              type="button"
              aria-label={`Remove reference ${index + 1}`}
              className="absolute right-0 top-0 grid size-5 place-items-center rounded-bl bg-background/90 text-foreground disabled:opacity-50"
              disabled={inputsLocked}
              onClick={() => store.removeEdge(reference.edge.id)}
            >
              <X className="size-3" />
            </button>
            {referenceLimit !== null && index >= referenceLimit && (
              <span className="absolute bottom-0 right-0 rounded-tl bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                초과
              </span>
            )}
          </div>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <span>모델</span>
        <select
          aria-label="Image model"
          className={SELECT_CLASS}
          value={storedModelUnavailable ? storedModelId ?? "" : model?.model_id ?? ""}
          disabled={inputsLocked || modelsLoading || compatibleModels.length === 0}
          onChange={(event) => patchProperties({ imageModelId: keywordProperty(event.target.value) })}
        >
          {storedModelUnavailable && storedModelId && (
            <option value={storedModelId}>사용할 수 없는 모델 ({storedModelId})</option>
          )}
          {compatibleModels.length === 0 && (
            <option value="">사용 가능한 모델 없음</option>
          )}
          {compatibleModels.map((candidate) => (
            <option key={candidate.model_id} value={candidate.model_id}>
              {candidate.display_name} · 참조 최대 {candidate.max_reference_images}장
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <CapabilitySelect
          label="비율"
          value={aspectRatio}
          choices={model?.supported_aspect_ratios ?? null}
          disabled={inputsLocked}
          onChange={(value) => patchProperties({ imageAspectRatio: keywordProperty(value) })}
        />
        <CapabilitySelect
          label="해상도"
          value={resolution}
          choices={model?.supported_resolutions ?? null}
          disabled={inputsLocked}
          onChange={(value) => patchProperties({ imageResolution: keywordProperty(value) })}
        />
        <CapabilitySelect
          label="품질"
          value={quality}
          choices={model?.supported_qualities ?? null}
          disabled={inputsLocked}
          onChange={(value) => patchProperties({ imageQuality: keywordProperty(value) })}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="h-9 flex-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canGenerate}
          onClick={() => {
            if (!model) return
            const latestPrompt = prompt.flushForGenerate()
            patchProperties({
              imagePrompt: { type: "text", text: latestPrompt },
              imageModelId: keywordProperty(model.model_id),
            })
            void generation.generate(
              model.model_id,
              latestPrompt,
              parameters,
              referenceSourceNodeUids,
            )
          }}
        >
          {busy ? "생성 중…" : "Generate"}
        </button>
        {generation.phase === "stalled" && (
          <button
            type="button"
            className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
            disabled={generation.hasPendingRequest}
            onClick={generation.checkStatusAgain}
          >
            상태 다시 확인
          </button>
        )}
        {generation.hasPendingRequest && (
          <button
            type="button"
            className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
            disabled={!canEdit || !generation.canResumePending || generation.phase === "starting"}
            onClick={() => void generation.resumePending()}
          >
            {generation.canResumePending ? "요청 재개" : "다른 사용자의 요청 대기 중"}
          </button>
        )}
      </div>

      {(generation.phase === "succeeded" || outputNode.outputNodeUid) && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
          {outputNode.outputNodeUid ? (
            outputNode.nodePresent ? (
              <>
                <span>완료</span>
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-1 text-foreground"
                  onClick={outputNode.selectResult}
                >
                  결과로 이동
                </button>
              </>
            ) : (
              <>
                <span>결과 노드가 없습니다.</span>
                {canEdit && (
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-foreground disabled:opacity-50"
                    disabled={outputNode.recreating}
                    onClick={() => void outputNode.recreate()}
                  >
                    {outputNode.recreating ? "추가 중…" : "결과 노드 다시 추가"}
                  </button>
                )}
              </>
            )
          ) : outputNode.error && canEdit ? (
            <>
              <span>결과 노드를 추가하지 못했습니다.</span>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-foreground disabled:opacity-50"
                disabled={outputNode.recreating}
                onClick={() => void outputNode.recreate()}
              >
                {outputNode.recreating ? "추가 중…" : "결과 노드 추가 다시 시도"}
              </button>
            </>
          ) : <span>완료 · 결과 노드 준비 중</span>}
        </div>
      )}

      {(modelsError || storedModelUnavailable || generation.error || outputNode.error) && (
        <p role="alert" className="text-xs text-destructive">
          {modelsError
            ?? (storedModelUnavailable
              ? "저장된 모델을 사용할 수 없습니다. 다른 모델을 선택해 주세요."
              : generation.error ?? outputNode.error)}
        </p>
      )}
      {model && references.length > model.max_reference_images && (
        <p role="alert" className="text-xs text-destructive">
          {referenceOverflow}장을 제거하거나 참조 한도가 더 큰 모델을 선택하세요.
        </p>
      )}
      <NodeFooter status={footerStatus}>
        <span>{phaseLabel(generation.phase)}</span>
      </NodeFooter>
    </div>
  )
}


/** Canvas view for a first-party image generator note. */
export function ImageGeneratorView({ id }: { id: NodeId }) {
  const node = useNode(id)
  const store = useCanvasStore()
  const canEdit = useBoardAppStore((state) => state.canEdit)
  const { local } = useBoardRuntime()
  const cardRef = useRef<HTMLDivElement>(null)
  useStopCanvasGesture(cardRef)

  const patchProperties = useCallback((patch: Partial<NoteProperties>): void => {
    const current = store.getNode(id)
    if (!current) return
    const currentData = (current.data ?? {}) as NoteNodeData
    store.updateNode(id, {
      data: {
        ...currentData,
        properties: {
          ...currentData.properties,
          ...patch,
        },
      },
    })
  }, [id, store])

  if (!node) return null
  const data = (node.data ?? {}) as NoteNodeData
  const properties = data.properties ?? {}
  const label = data.label?.markdown

  return (
    <div className="pointer-events-none relative h-full w-full select-none">
      <div
        ref={cardRef}
        className="pointer-events-auto absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
      >
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-10 text-sm font-semibold text-foreground">
          <ImageStackIcon className="size-4 shrink-0" />
          <NodeTitleCaption
            nodeId={id}
            label={label}
            placeholder="Image Generator"
            className="min-w-0 flex-1"
            textClassName="truncate text-left text-sm font-semibold text-foreground"
            maxLines={1}
          />
        </div>
        <div className="min-h-0 flex-1">
          {local ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <ImageStackIcon className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">서버 보드에서만 사용할 수 있습니다.</p>
              <p className="text-xs text-muted-foreground">
                이 노드를 동기화된 보드로 옮긴 뒤 이미지를 생성하세요.
              </p>
            </div>
          ) : (
            <SyncedImageGeneratorCard
              id={id}
              data={data}
              properties={properties}
              canEdit={canEdit}
              patchProperties={patchProperties}
            />
          )}
        </div>
      </div>

      <NodeTrafficLights
        onDelete={canEdit ? () => removeNodeSubtree(store, id) : undefined}
      />
    </div>
  )
}
