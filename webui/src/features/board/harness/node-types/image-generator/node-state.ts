import type { KeywordProperty, TextProperty } from "@/features/newsfeed/types/properties"
import type { GenerationParameters } from "@/features/board/api/image-generation"


export const PENDING_IMAGE_REQUEST_VERSION = 1


const MAX_PENDING_SNAPSHOT_LENGTH = 64 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i


export type PendingImageRequest = {
  version: 1
  boardUid: string
  generatorNodeUid: string
  initiatorUserUid: string
  clientRequestUid: string
  modelId: string
  prompt: string
  parameters: GenerationParameters
}


/** Read a non-empty string from a KeywordProperty. */
export function readKeywordProperty(property: KeywordProperty | undefined): string | null {
  return typeof property?.value === "string" && property.value.length > 0
    ? property.value
    : null
}


/** Read text while treating an absent TextProperty as empty. */
export function readTextProperty(property: TextProperty | undefined): string {
  return typeof property?.text === "string" ? property.text : ""
}


/** Build a non-searchable text property for internal request metadata. */
export function internalTextProperty(text: string): TextProperty {
  return { type: "text", text, searchable: false }
}


/** Build a keyword property using the repository's real `value` contract. */
export function keywordProperty(value: string): KeywordProperty {
  return { type: "keyword", value }
}


/** Return parameters in a stable key order with no null or blank values. */
export function canonicalGenerationParameters(parameters: GenerationParameters): GenerationParameters {
  const canonical: GenerationParameters = {}
  if (parameters.aspect_ratio) canonical.aspect_ratio = parameters.aspect_ratio
  if (parameters.resolution) canonical.resolution = parameters.resolution
  if (parameters.quality) canonical.quality = parameters.quality
  if (parameters.output_count !== undefined) canonical.output_count = parameters.output_count
  return canonical
}


/** Serialize an owned pending request into its canonical node-data form. */
export function serializePendingImageRequest(snapshot: PendingImageRequest): string {
  return JSON.stringify({
    version: PENDING_IMAGE_REQUEST_VERSION,
    boardUid: snapshot.boardUid,
    generatorNodeUid: snapshot.generatorNodeUid,
    initiatorUserUid: snapshot.initiatorUserUid,
    clientRequestUid: snapshot.clientRequestUid,
    modelId: snapshot.modelId,
    prompt: snapshot.prompt,
    parameters: canonicalGenerationParameters(snapshot.parameters),
  })
}


const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)


const optionalNonEmptyString = (
  record: Record<string, unknown>,
  key: keyof GenerationParameters,
): string | undefined | false => {
  const value = record[key]
  if (value === undefined) return undefined
  return typeof value === "string" && value.length > 0 ? value : false
}


/** Parse and validate a pending request before it can trigger a provider-backed POST. */
export function parsePendingImageRequest(raw: string): PendingImageRequest | null {
  if (!raw || raw.length > MAX_PENDING_SNAPSHOT_LENGTH) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.version !== PENDING_IMAGE_REQUEST_VERSION) return null

  const required = [
    parsed.boardUid,
    parsed.generatorNodeUid,
    parsed.initiatorUserUid,
    parsed.clientRequestUid,
    parsed.modelId,
  ]
  if (required.some((value) => typeof value !== "string" || value.length === 0 || value.length > 200)) {
    return null
  }
  if (!UUID_PATTERN.test(parsed.clientRequestUid as string)) return null
  if (typeof parsed.prompt !== "string" || !parsed.prompt.trim() || parsed.prompt.length > 32_000) {
    return null
  }
  if (!isRecord(parsed.parameters)) return null
  if (Object.keys(parsed.parameters).some((key) => !["aspect_ratio", "resolution", "quality", "output_count"].includes(key))) {
    return null
  }

  const aspectRatio = optionalNonEmptyString(parsed.parameters, "aspect_ratio")
  const resolution = optionalNonEmptyString(parsed.parameters, "resolution")
  const quality = optionalNonEmptyString(parsed.parameters, "quality")
  if (aspectRatio === false || resolution === false || quality === false) return null
  const outputCount = parsed.parameters.output_count
  if (outputCount !== undefined && (!Number.isInteger(outputCount) || Number(outputCount) < 1)) {
    return null
  }

  return {
    version: PENDING_IMAGE_REQUEST_VERSION,
    boardUid: parsed.boardUid as string,
    generatorNodeUid: parsed.generatorNodeUid as string,
    initiatorUserUid: parsed.initiatorUserUid as string,
    clientRequestUid: parsed.clientRequestUid as string,
    modelId: parsed.modelId as string,
    prompt: parsed.prompt,
    parameters: canonicalGenerationParameters({
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      ...(quality ? { quality } : {}),
      ...(outputCount !== undefined ? { output_count: Number(outputCount) } : {}),
    }),
  }
}


/** Verify that a recoverable request belongs to this exact board node. */
export function isOwnedPendingImageRequest(
  snapshot: PendingImageRequest | null,
  boardUid: string,
  nodeUid: string,
  userUid: string,
): snapshot is PendingImageRequest {
  return snapshot !== null
    && snapshot.version === PENDING_IMAGE_REQUEST_VERSION
    && snapshot.boardUid === boardUid
    && snapshot.generatorNodeUid === nodeUid
    && snapshot.initiatorUserUid === userUid
}


/** Explicit clear sentinels survive the backend's deep-merge property patches. */
export const CLEARED_IMAGE_PENDING_REQUEST = internalTextProperty("")
export const CLEARED_ACTIVE_GENERATION_UID = keywordProperty("")
