import type { CanvasStore, NodeId } from "@canvas-harness/core"

import { uploadImageAsset, type ImageAssetUpload } from "@/features/board/api/image-generation"
import type { KeywordProperty } from "@/features/newsfeed/types/properties"
import type { NoteNodeData } from "./convert/note-to-node"


const ASSET_UID_PATTERN = /^[0-9a-f]{32}$/i
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024
const MAX_REFERENCE_BASE64_LENGTH = Math.ceil(MAX_REFERENCE_BYTES / 3) * 4


export const IMAGE_REFERENCE_CHANGED_MESSAGE = "The reference image changed. Review it and generate again."
export const IMAGE_REFERENCE_BOARD_UNAVAILABLE_MESSAGE = "The reference node is unavailable on this board."
export const IMAGE_REFERENCE_UNAVAILABLE_MESSAGE = "This image node cannot be registered as a reference asset."
export const IMAGE_REFERENCE_INVALID_RESPONSE_MESSAGE = "The reference-asset response could not be verified."


/** Signal that a canvas image no longer matches its captured local version. */
export class ImageReferenceVersionChangedError extends Error {}


/** Signal a determinate local materialization failure with safe UI copy. */
export class ImageReferenceMaterializationError extends Error {}


export type ImageSourceVersion = {
  src: string | null
  assetUid: string | null
}


export const CLEARED_IMAGE_ASSET_UID: KeywordProperty = {
  type: "keyword",
  value: "",
}


/** Validate the internal UID syntax generated for immutable image assets. */
export function isImageAssetUid(value: unknown): value is string {
  return typeof value === "string" && ASSET_UID_PATTERN.test(value)
}


/** Read only a generated internal asset UID from a keyword value. */
export function readImageAssetUid(property: KeywordProperty | undefined): string | null {
  const value = property?.value
  return isImageAssetUid(value) ? value : null
}


/** Convert one bounded Blob into a renderable data URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("The image preview could not be created."))
    }
    reader.onerror = () => reject(new Error("The image preview could not be created."))
    reader.readAsDataURL(blob)
  })
}


/** Decode one bounded PNG/JPEG/WebP data URL without fetching arbitrary URLs. */
export function imageDataUrlToBlob(dataUrl: string): Blob {
  const match = DATA_URL_PATTERN.exec(dataUrl)
  if (!match || match[2].length > MAX_REFERENCE_BASE64_LENGTH) {
    throw new ImageReferenceMaterializationError(IMAGE_REFERENCE_UNAVAILABLE_MESSAGE)
  }

  let decoded: string
  try {
    decoded = atob(match[2])
  } catch {
    throw new ImageReferenceMaterializationError(IMAGE_REFERENCE_UNAVAILABLE_MESSAGE)
  }
  if (decoded.length === 0 || decoded.length > MAX_REFERENCE_BYTES) {
    throw new ImageReferenceMaterializationError(IMAGE_REFERENCE_UNAVAILABLE_MESSAGE)
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
  expectedVersion?: ImageSourceVersion
}): Promise<string> {
  const {
    store,
    graphId,
    nodeId,
    signal,
    upload = uploadImageAsset,
    expectedVersion,
  } = args
  const node = store.getNode(nodeId)
  const data = (node?.data ?? {}) as NoteNodeData & { src?: unknown }
  if (!node || node.type !== "image" || data.graphUid !== graphId) {
    if (expectedVersion) {
      throw new ImageReferenceVersionChangedError(IMAGE_REFERENCE_CHANGED_MESSAGE)
    }
    throw new ImageReferenceMaterializationError(
      IMAGE_REFERENCE_BOARD_UNAVAILABLE_MESSAGE,
    )
  }

  const existing = readImageAssetUid(data.properties?.imageAssetUid)
  const sourceVersion: ImageSourceVersion = {
    src: typeof data.src === "string" ? data.src : null,
    assetUid: existing,
  }
  if (
    expectedVersion
    && (
      sourceVersion.src !== expectedVersion.src
      || sourceVersion.assetUid !== expectedVersion.assetUid
    )
  ) {
    throw new ImageReferenceVersionChangedError(IMAGE_REFERENCE_CHANGED_MESSAGE)
  }
  if (existing) return existing
  if (sourceVersion.src === null) {
    throw new ImageReferenceMaterializationError(IMAGE_REFERENCE_UNAVAILABLE_MESSAGE)
  }

  const blob = imageDataUrlToBlob(sourceVersion.src)
  const extension = blob.type === "image/png"
    ? "png"
    : blob.type === "image/webp"
    ? "webp"
    : "jpg"
  const asset = await upload(graphId, blob, `reference.${extension}`, signal)
  if (!isImageAssetUid(asset.asset_uid)) {
    throw new ImageReferenceMaterializationError(IMAGE_REFERENCE_INVALID_RESPONSE_MESSAGE)
  }
  signal?.throwIfAborted()

  const current = store.getNode(nodeId)
  const currentData = (current?.data ?? {}) as NoteNodeData & { src?: unknown }
  if (!current || current.type !== "image" || currentData.graphUid !== graphId) {
    throw new ImageReferenceVersionChangedError(IMAGE_REFERENCE_CHANGED_MESSAGE)
  }
  const currentSrc = typeof currentData.src === "string" ? currentData.src : null
  const currentAssetUid = readImageAssetUid(currentData.properties?.imageAssetUid)
  if (
    currentSrc !== sourceVersion.src
    || (currentAssetUid !== sourceVersion.assetUid && currentAssetUid !== asset.asset_uid)
  ) {
    throw new ImageReferenceVersionChangedError(IMAGE_REFERENCE_CHANGED_MESSAGE)
  }
  if (currentAssetUid === asset.asset_uid) return asset.asset_uid
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
