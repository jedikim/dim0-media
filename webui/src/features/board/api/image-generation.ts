import { apiFetch } from "@/api"


export type ImageGenerationStatus = "started" | "retryable" | "succeeded" | "failed"


/** Server statuses that still require polling. */
export const NON_TERMINAL_IMAGE_STATUSES: ReadonlySet<ImageGenerationStatus> = new Set([
  "started",
  "retryable",
])


export type ImageModel = {
  model_id: string
  display_name: string
  supports_text_to_image: boolean
  supports_image_to_image: boolean
  max_reference_images: number
  supported_resolutions: string[] | null
  supported_aspect_ratios: string[] | null
  supported_qualities: string[] | null
  max_output_images: number
  verified_at: string
}


export type GenerationParameters = {
  aspect_ratio?: string
  resolution?: string
  quality?: string
  output_count?: number
}


export type GenerationAccepted = {
  generation_uid: string
  status: ImageGenerationStatus
}


export type GenerationState = {
  generation_uid: string
  status: ImageGenerationStatus
  model_id: string
  started_at: string
  completed_at: string | null
  output_asset_uid: string | null
  output_content_url: string | null
  error_code: string | null
  error_message: string | null
}


/** Extract the HTTP status prefix emitted by apiFetch. */
export function imageGenerationStatusCode(error: unknown): number | null {
  const match = error instanceof Error ? /^(\d{3})\b/.exec(error.message) : null
  return match ? Number(match[1]) : null
}


/** Map transport and server failures to fixed, provider-safe UI copy. */
export function imageGenerationErrorMessage(error: unknown): string {
  switch (imageGenerationStatusCode(error)) {
    case 400:
    case 422:
      return "선택한 모델이 이 요청을 지원하지 않습니다."
    case 401:
    case 403:
      return "이 보드에서 이미지를 생성할 권한이 없습니다."
    case 404:
      return "보드나 이미지 생성 기록을 찾을 수 없습니다."
    case 409:
      return "같은 요청의 처리 여부를 확인할 수 없습니다. 요청을 재개해 주세요."
    case 429:
      return "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요."
    case 503:
      return "이미지 생성 서비스가 일시적으로 중단되었습니다."
    default:
      return "이미지 생성 요청을 확인할 수 없습니다."
  }
}


let imageModelsPromise: Promise<ImageModel[]> | null = null


/** Fetch and cache only a successful server model catalog. */
export function listImageModels(): Promise<ImageModel[]> {
  if (imageModelsPromise) return imageModelsPromise
  imageModelsPromise = apiFetch<{ models: ImageModel[] }>({ path: "/image-models" })
    .then((response) => response.models)
    .catch((error: unknown) => {
      imageModelsPromise = null
      throw error
    })
  return imageModelsPromise
}


/** Start one idempotent server-side image generation. */
export function startImageGeneration(args: {
  graphId: string
  clientRequestUid: string
  modelId: string
  prompt: string
  parameters: GenerationParameters
  referenceAssetUids?: string[]
  generatorNodeUid: string | null
  signal?: AbortSignal
}): Promise<GenerationAccepted> {
  return apiFetch<GenerationAccepted>({
    path: `/boards/${encodeURIComponent(args.graphId)}/image-generations`,
    method: "POST",
    signal: args.signal,
    body: {
      client_request_uid: args.clientRequestUid,
      model_id: args.modelId,
      prompt: args.prompt,
      parameters: args.parameters,
      reference_asset_uids: args.referenceAssetUids ?? [],
      generator_node_uid: args.generatorNodeUid,
    },
  })
}


/** Read one board-scoped generation status. */
export function getImageGeneration(
  graphId: string,
  generationUid: string,
  signal?: AbortSignal,
): Promise<GenerationState> {
  return apiFetch<GenerationState>({
    path: `/boards/${encodeURIComponent(graphId)}/image-generations/${encodeURIComponent(generationUid)}`,
    signal,
  })
}


/** Fetch authorized image bytes without exposing a storage path. */
export function fetchImageAssetBlob(
  graphId: string,
  assetUid: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return apiFetch<Blob>({
    path: `/boards/${encodeURIComponent(graphId)}/image-assets/${encodeURIComponent(assetUid)}/content`,
    responseType: "blob",
    signal,
  })
}
