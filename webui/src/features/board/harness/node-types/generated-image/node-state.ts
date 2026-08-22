import type { NoteProperties } from "@/features/board/types/note"
import { readImageAssetUid } from "../../image-reference-assets"
import { readKeywordProperty } from "../image-generator/node-state"


export const GENERATED_IMAGE_MARKER_VALUE = "immutable-result"
export const GENERATED_IMAGE_UNAVAILABLE_MESSAGE = "이 생성 이미지는 이 보드에서 사용할 수 없습니다."


export type GeneratedImageAssociation = {
  assetUid: string
  generationUid: string
  generatorNodeUid: string
}


/** Read only a complete immutable generated-image association. */
export function readGeneratedImageAssociation(
  properties: Partial<NoteProperties>,
): GeneratedImageAssociation | null {
  if (readKeywordProperty(properties.generatedImageMarker) !== GENERATED_IMAGE_MARKER_VALUE) {
    return null
  }
  const assetUid = readImageAssetUid(properties.imageAssetUid)
  const generationUid = readKeywordProperty(properties.generatedImageGenerationUid)
  const generatorNodeUid = readKeywordProperty(properties.generatedImageGeneratorNodeUid)
  if (!assetUid || !generationUid || !generatorNodeUid) return null
  return { assetUid, generationUid, generatorNodeUid }
}
