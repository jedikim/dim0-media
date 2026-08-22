import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { NodeId } from "@canvas-harness/core"
import { useCanvasStore, useNode } from "@canvas-harness/react"

import { ImageStackIcon } from "@/components/icons"
import {
  imageGenerationErrorMessage,
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
import type { NoteNodeData } from "../../convert/note-to-node"
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


const SELECT_CLASS =
  "h-8 min-w-0 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"


const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-50"


const isSupportedChoice = (value: string | null, choices: string[] | null): value is string =>
  value !== null && choices !== null && choices.includes(value)


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
    case "starting": return "요청 저장 중"
    case "running": return "이미지 생성 중"
    case "succeeded": return "완료"
    case "failed": return "확인 필요"
    case "stalled": return "상태 확인 지연"
    default: return "준비됨"
  }
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
  const graphId = data.graphUid
  const nodeId = String(id)
  const userId = useAppStore((state) => state.userId)
  const rawPendingRequest = readTextProperty(properties.imagePendingRequest)
  const pendingRequest = useMemo(
    () => parsePendingImageRequest(rawPendingRequest),
    [rawPendingRequest],
  )

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

  const storedModelId = readKeywordProperty(properties.imageModelId)
  const model = useMemo(() => {
    const selected = models.find((candidate) => candidate.model_id === storedModelId)
    return selected ?? models.find((candidate) => candidate.supports_text_to_image) ?? null
  }, [models, storedModelId])
  const prompt = readTextProperty(properties.imagePrompt)
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

  const { url: previewUrl, failed: previewFailed } = useAuthedImage(
    graphId,
    generation.state?.output_asset_uid ?? null,
  )
  const busy = generation.phase === "starting"
    || generation.phase === "running"
    || generation.phase === "stalled"
  const canGenerate = canEdit
    && !modelsLoading
    && !modelsError
    && model?.supports_text_to_image === true
    && prompt.trim().length > 0
    && !busy
    && !generation.hasPendingRequest
  const footerStatus = generation.phase === "starting" || generation.phase === "running"
    ? "saving"
    : generation.phase === "succeeded"
    ? "saved"
    : generation.phase === "failed" || generation.phase === "stalled"
    ? "error"
    : "idle"

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 pt-10">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ImageStackIcon className="size-4 shrink-0" />
        <span>Image Generator</span>
      </div>

      <textarea
        aria-label="Image prompt"
        className={cn(INPUT_CLASS, "min-h-20 resize-none")}
        value={prompt}
        disabled={!canEdit || busy}
        maxLength={32_000}
        placeholder="만들고 싶은 이미지를 설명하세요"
        onChange={(event) => patchProperties({
          imagePrompt: { type: "text", text: event.target.value },
        })}
      />

      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <span>모델</span>
        <select
          aria-label="Image model"
          className={SELECT_CLASS}
          value={model?.model_id ?? ""}
          disabled={!canEdit || busy || modelsLoading || models.length === 0}
          onChange={(event) => patchProperties({ imageModelId: keywordProperty(event.target.value) })}
        >
          {models.length === 0 && <option value="">사용 가능한 모델 없음</option>}
          {models.map((candidate) => (
            <option key={candidate.model_id} value={candidate.model_id}>
              {candidate.display_name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <CapabilitySelect
          label="비율"
          value={aspectRatio}
          choices={model?.supported_aspect_ratios ?? null}
          disabled={!canEdit || busy}
          onChange={(value) => patchProperties({ imageAspectRatio: keywordProperty(value) })}
        />
        <CapabilitySelect
          label="해상도"
          value={resolution}
          choices={model?.supported_resolutions ?? null}
          disabled={!canEdit || busy}
          onChange={(value) => patchProperties({ imageResolution: keywordProperty(value) })}
        />
        <CapabilitySelect
          label="품질"
          value={quality}
          choices={model?.supported_qualities ?? null}
          disabled={!canEdit || busy}
          onChange={(value) => patchProperties({ imageQuality: keywordProperty(value) })}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="h-9 flex-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canGenerate}
          onClick={() => model && void generation.generate(model.model_id, prompt, parameters)}
        >
          {busy ? "생성 중…" : "Generate"}
        </button>
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

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted/30">
        {previewUrl ? (
          <img className="h-full w-full object-contain" src={previewUrl} alt="생성된 이미지" />
        ) : (
          <span className="px-4 text-center text-xs text-muted-foreground">
            {previewFailed ? "결과 이미지를 불러올 수 없습니다." : "생성된 이미지가 여기에 표시됩니다."}
          </span>
        )}
      </div>

      {(modelsError || generation.error) && (
        <p role="alert" className="text-xs text-destructive">
          {modelsError ?? generation.error}
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
        className="pointer-events-auto absolute inset-0 overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
      >
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

      <NodeTrafficLights
        onDelete={canEdit ? () => removeNodeSubtree(store, id) : undefined}
      />
      <div className="pointer-events-auto absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2">
        <NodeTitleCaption
          nodeId={id}
          label={label}
          placeholder="Image generator"
          textClassName="text-center text-sm font-handwriting text-foreground"
        />
      </div>
    </div>
  )
}
