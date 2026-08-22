import type { CanvasStore, NodeId } from "@canvas-harness/core"

import { uploadImageAsset, type ImageAssetUpload } from "@/features/board/api/image-generation"
import type { KeywordProperty } from "@/features/newsfeed/types/properties"
import type { NoteNodeData } from "./convert/note-to-node"


const ASSET_UID_PATTERN = /^[0-9a-f]{32}$/i
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024
const MAX_REFERENCE_BASE64_LENGTH = Math.ceil(MAX_REFERENCE_BYTES / 3) * 4


export const CLEARED_IMAGE_ASSET_UID: KeywordProperty = {
  type: "keyword",
  value: "",
}


/** Read only a generated internal asset UID from a keyword value. */
export function readImageAssetUid(property: KeywordProperty | undefined): string | null {
  const value = property?.value
  return typeof value === "string" && ASSET_UID_PATTERN.test(value) ? value : null
}


/** Convert one bounded Blob into a renderable data URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("이미지 미리보기를 만들 수 없습니다."))
    }
    reader.onerror = () => reject(new Error("이미지 미리보기를 만들 수 없습니다."))
    reader.readAsDataURL(blob)
  })
}


/** Decode one bounded PNG/JPEG/WebP data URL without fetching arbitrary URLs. */
export function imageDataUrlToBlob(dataUrl: string): Blob {
  const match = DATA_URL_PATTERN.exec(dataUrl)
  if (!match || match[2].length > MAX_REFERENCE_BASE64_LENGTH) {
    throw new Error("이 이미지 노드는 참조 자산으로 등록할 수 없습니다.")
  }

  let decoded: string
  try {
    decoded = atob(match[2])
  } catch {
    throw new Error("이 이미지 노드는 참조 자산으로 등록할 수 없습니다.")
  }
  if (decoded.length === 0 || decoded.length > MAX_REFERENCE_BYTES) {
    throw new Error("이 이미지 노드는 참조 자산으로 등록할 수 없습니다.")
  }
  const content = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    content[index] = decoded.charCodeAt(index)
  }
  return new Blob([content], { type: match[1] })
}


export type UploadImageAsset = (
  graphId: string,
  blob: Blob,
  filename: string,
  signal?: AbortSignal,
) => Promise<ImageAssetUpload>


/** Resolve or explicitly materialize one image node into a board asset UID. */
export async function materializeImageNodeAsset(args: {
  store: CanvasStore
  graphId: string
  nodeId: NodeId
  signal?: AbortSignal
  upload?: UploadImageAsset
}): Promise<string> {
  const { store, graphId, nodeId, signal, upload = uploadImageAsset } = args
  const node = store.getNode(nodeId)
  const data = (node?.data ?? {}) as NoteNodeData & { src?: unknown }
  if (!node || node.type !== "image" || data.graphUid !== graphId) {
    throw new Error("참조 이미지 노드를 이 보드에서 사용할 수 없습니다.")
  }

  const existing = readImageAssetUid(data.properties?.imageAssetUid)
  if (existing) return existing
  if (typeof data.src !== "string") {
    throw new Error("이 이미지 노드는 참조 자산으로 등록할 수 없습니다.")
  }

  const blob = imageDataUrlToBlob(data.src)
  const extension = blob.type === "image/png"
    ? "png"
    : blob.type === "image/webp"
    ? "webp"
    : "jpg"
  const asset = await upload(graphId, blob, `reference.${extension}`, signal)
  if (!ASSET_UID_PATTERN.test(asset.asset_uid)) {
    throw new Error("참조 자산 등록 응답을 확인할 수 없습니다.")
  }

  const current = store.getNode(nodeId)
  const currentData = (current?.data ?? {}) as NoteNodeData
  if (!current || current.type !== "image" || currentData.graphUid !== graphId) {
    throw new Error("참조 이미지 노드를 이 보드에서 사용할 수 없습니다.")
  }
  store.updateNode(nodeId, {
    data: {
      ...currentData,
      properties: {
        ...currentData.properties,
        imageAssetUid: { type: "keyword", value: asset.asset_uid },
      },
    },
  })
  return asset.asset_uid
}
