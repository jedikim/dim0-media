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
  default_parameters: GenerationParameters
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


export type GenerationReferenceDetails = {
  ordinal: number
  asset_uid: string
  mime_type: string
  width: number
  height: number
  content_url: string
}


export type GenerationDetails = {
  generation_uid: string
  model_id: string
  prompt: string
  parameters: GenerationParameters
  references: GenerationReferenceDetails[]
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
  image_reference_unavailable: "The reference image could not be found or is unavailable on this board.",
  unsupported_reference_format: "Reference images must be PNG, JPEG, or WebP.",
  reference_too_large: "A reference image exceeds the file-size limit.",
  reference_pixel_limit_exceeded: "A reference image exceeds the pixel limit.",
  reference_request_too_large: "The reference images exceed the total file-size limit.",
  reference_encoded_size_exceeded: "The encoded reference request exceeds the size limit.",
  reference_limit_exceeded: "The selected model's reference-image limit was exceeded.",
  image_to_image_unsupported: "The selected model does not support image-to-image generation.",
  generation_not_succeeded: "Only a completed generation can be added as a result node.",
  output_asset_unavailable: "The generated image asset is unavailable.",
  generator_unavailable: "The source image generator node could not be found.",
  materialization_raced: "Result-node creation overlapped another request. Try again shortly.",
  canonical_collision: "The result-node identifier conflicts with existing board data.",
  canvas_write_incomplete: "The result node could not be saved. Try again shortly.",
  output_binding_conflict: "The result node could not be linked to the generation record.",
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
      return "The selected model does not support this request."
    case 401:
    case 403:
      return "You do not have permission to generate images on this board."
    case 404:
      return "The board or image-generation record could not be found."
    case 409:
      return "This request ID was already used for different content. Start a new generation."
    case 413:
      return "A reference image exceeds the allowed size or resolution."
    case 429:
      return "Too many requests. Try again shortly."
    case 503:
      return "Image generation is temporarily unavailable."
    default:
      return "The image-generation request could not be verified."
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


/** Lazily read immutable prompt, options, and ordered reference provenance. */
export function getImageGenerationDetails(
  graphId: string,
  generationUid: string,
  signal?: AbortSignal,
): Promise<GenerationDetails> {
  return apiFetch<GenerationDetails>({
    path: `/boards/${encodeURIComponent(graphId)}/image-generations/${encodeURIComponent(generationUid)}/details`,
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
