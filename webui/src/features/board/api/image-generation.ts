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
  output_node_uid: string | null
  output_asset_uid: string | null
  output_content_url: string | null
  error_code: string | null
  error_message: string | null
}


export type GenerationOutputNode = {
  generation_uid: string
  output_node_uid: string
  output_asset_uid: string
  created: boolean
  recreated: boolean
}


export type ImageAssetUpload = {
  asset_uid: string
  mime_type: "image/png" | "image/jpeg" | "image/webp"
  width: number
  height: number
  byte_size: number
  content_sha256: string
}


export type ImageGenerationErrorDetail = {
  code: string
  message: string
}


const REFERENCE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  image_reference_unavailable: "참조 이미지를 찾거나 이 보드에서 사용할 수 없습니다.",
  unsupported_reference_format: "참조 이미지는 PNG, JPEG 또는 WebP 형식이어야 합니다.",
  reference_too_large: "참조 이미지 한 장의 파일 크기가 제한을 초과했습니다.",
  reference_pixel_limit_exceeded: "참조 이미지 한 장의 해상도가 제한을 초과했습니다.",
  reference_request_too_large: "참조 이미지 전체 파일 크기가 제한을 초과했습니다.",
  reference_encoded_size_exceeded: "참조 이미지 전체 요청 크기가 제한을 초과했습니다.",
  reference_limit_exceeded: "선택한 모델의 참조 이미지 개수 제한을 초과했습니다.",
  image_to_image_unsupported: "선택한 모델은 참조 이미지 생성을 지원하지 않습니다.",
  generation_not_succeeded: "완료된 이미지 생성만 결과 노드로 추가할 수 있습니다.",
  output_asset_unavailable: "생성된 이미지 자산을 사용할 수 없습니다.",
  generator_unavailable: "원본 이미지 생성 노드를 찾을 수 없습니다.",
  canonical_collision: "결과 노드 식별자가 기존 보드 데이터와 충돌합니다.",
  canvas_write_incomplete: "결과 노드를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  output_binding_conflict: "결과 노드를 생성 기록에 연결하지 못했습니다.",
}


const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)


/** Extract the HTTP status prefix emitted by apiFetch. */
export function imageGenerationStatusCode(error: unknown): number | null {
  const match = error instanceof Error ? /^(\d{3})\b/.exec(error.message) : null
  return match ? Number(match[1]) : null
}


/** Parse the existing apiFetch message envelope without trusting arbitrary bodies. */
export function imageGenerationErrorDetail(error: unknown): ImageGenerationErrorDetail | null {
  if (!(error instanceof Error)) return null
  const delimiter = error.message.indexOf(" - ")
  if (delimiter < 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(error.message.slice(delimiter + 3))
  } catch {
    return null
  }
  if (!isRecord(parsed) || !isRecord(parsed.detail)) return null
  const { code, message } = parsed.detail
  if (
    typeof code !== "string"
    || code.length === 0
    || code.length > 100
    || typeof message !== "string"
    || message.length === 0
    || message.length > 500
  ) return null
  return { code, message }
}


/** Map transport and server failures to fixed, provider-safe UI copy. */
export function imageGenerationErrorMessage(error: unknown): string {
  const detail = imageGenerationErrorDetail(error)
  if (detail && detail.code in REFERENCE_ERROR_MESSAGES) {
    return REFERENCE_ERROR_MESSAGES[detail.code]
  }
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
      return "요청 식별자가 다른 내용에 이미 사용되었습니다. 다시 생성해 주세요."
    case 413:
      return "참조 이미지가 허용된 크기 또는 해상도를 초과했습니다."
    case 429:
      return "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요."
    case 503:
      return "이미지 생성 서비스가 일시적으로 중단되었습니다."
    default:
      return "이미지 생성 요청을 확인할 수 없습니다."
  }
}


/** Upload one bounded raster into the board's immutable image-asset collection. */
export function uploadImageAsset(
  graphId: string,
  blob: Blob,
  filename: string,
  signal?: AbortSignal,
): Promise<ImageAssetUpload> {
  const form = new FormData()
  form.append("file", blob, filename)
  return apiFetch<ImageAssetUpload>({
    path: `/boards/${encodeURIComponent(graphId)}/image-assets`,
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
    signal,
  })
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


/** Ensure or explicitly restore one generation's canonical canvas result. */
export function ensureImageGenerationOutputNode(
  graphId: string,
  generationUid: string,
  recreate = false,
  signal?: AbortSignal,
): Promise<GenerationOutputNode> {
  return apiFetch<GenerationOutputNode>({
    path: `/boards/${encodeURIComponent(graphId)}/image-generations/${encodeURIComponent(generationUid)}/output-node`,
    method: "PUT",
    body: { recreate },
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
