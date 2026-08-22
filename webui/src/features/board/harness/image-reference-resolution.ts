import { asNodeId, type CanvasStore } from "@canvas-harness/core"

import { getImageGeneration } from "@/features/board/api/image-generation"
import type { NoteNodeData } from "./convert/note-to-node"
import {
  IMAGE_REFERENCE_CHANGED_MESSAGE,
  ImageReferenceMaterializationError,
  ImageReferenceVersionChangedError,
  isImageAssetUid,
  materializeImageNodeAsset,
  readImageAssetUid,
  type UploadImageAsset,
} from "./image-reference-assets"
import { readKeywordProperty } from "./node-types/image-generator/node-state"


/** Marker for fixed client-side reference resolution messages. */
export class ImageReferenceResolutionError extends Error {}


type ImageReferenceSourceDescriptor = {
  sourceNodeUid: string
  graphUid: string
} & (
  | {
      nodeType: "image-generator"
      activeGenerationUid: string
    }
  | {
      nodeType: "image"
      imageAssetUid: string | null
      src: string | null
    }
)


/** Capture every ordered source version synchronously before resolution awaits. */
function captureReferenceSourceDescriptors(args: {
  store: CanvasStore
  graphId: string
  sourceNodeUids: readonly string[]
}): ImageReferenceSourceDescriptor[] {
  const { store, graphId, sourceNodeUids } = args
  if (new Set(sourceNodeUids).size !== sourceNodeUids.length) {
    throw new ImageReferenceResolutionError("같은 참조 노드를 두 번 연결할 수 없습니다.")
  }

  return sourceNodeUids.map((sourceNodeUid) => {
    const node = store.getNode(asNodeId(sourceNodeUid))
    const data = (node?.data ?? {}) as NoteNodeData & { src?: unknown }
    if (!node || data.graphUid !== graphId) {
      throw new ImageReferenceResolutionError("참조 노드를 이 보드에서 사용할 수 없습니다.")
    }
    if (node.type === "image-generator") {
      const activeGenerationUid = readKeywordProperty(data.properties?.activeGenerationUid)
      if (!activeGenerationUid) {
        throw new ImageReferenceResolutionError("참조 생성 노드에 완료된 이미지가 없습니다.")
      }
      return {
        sourceNodeUid,
        graphUid: graphId,
        nodeType: "image-generator" as const,
        activeGenerationUid,
      }
    }
    if (node.type !== "image") {
      throw new ImageReferenceResolutionError("지원하지 않는 참조 노드입니다.")
    }

    const imageAssetUid = readImageAssetUid(data.properties?.imageAssetUid)
    const src = typeof data.src === "string" ? data.src : null
    if (!imageAssetUid && !src) {
      throw new ImageReferenceResolutionError("이 이미지 노드는 참조 자산으로 등록할 수 없습니다.")
    }
    return {
      sourceNodeUid,
      graphUid: graphId,
      nodeType: "image" as const,
      imageAssetUid,
      src,
    }
  })
}


/** Reject any source or edge version that diverged from the click-time capture. */
function assertReferenceSourcesUnchanged(args: {
  store: CanvasStore
  graphId: string
  descriptors: readonly ImageReferenceSourceDescriptor[]
  assetUids: readonly string[]
  currentSourceNodeUids: readonly string[]
}): void {
  const { store, graphId, descriptors, assetUids, currentSourceNodeUids } = args
  const changed = (): never => {
    throw new ImageReferenceResolutionError(IMAGE_REFERENCE_CHANGED_MESSAGE)
  }
  if (
    currentSourceNodeUids.length !== descriptors.length
    || currentSourceNodeUids.some((uid, index) => uid !== descriptors[index]?.sourceNodeUid)
    || assetUids.length !== descriptors.length
  ) changed()

  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index]
    const node = store.getNode(asNodeId(descriptor.sourceNodeUid))
    const data = (node?.data ?? {}) as NoteNodeData & { src?: unknown }
    if (
      !node
      || data.graphUid !== graphId
      || data.graphUid !== descriptor.graphUid
      || node.type !== descriptor.nodeType
    ) changed()

    if (descriptor.nodeType === "image-generator") {
      if (
        readKeywordProperty(data.properties?.activeGenerationUid)
        !== descriptor.activeGenerationUid
      ) changed()
      continue
    }

    const currentSrc = typeof data.src === "string" ? data.src : null
    const currentAssetUid = readImageAssetUid(data.properties?.imageAssetUid)
    const resolvedAssetUid = assetUids[index]
    const expectedAssetUid = descriptor.imageAssetUid ?? resolvedAssetUid
    if (
      currentSrc !== descriptor.src
      || !isImageAssetUid(resolvedAssetUid)
      || currentAssetUid !== expectedAssetUid
      || resolvedAssetUid !== expectedAssetUid
    ) changed()
  }
}


/** Resolve ordered canvas sources into immutable asset UIDs without provider work. */
export async function resolveReferenceAssetUids(args: {
  store: CanvasStore
  graphId: string
  sourceNodeUids: readonly string[]
  signal?: AbortSignal
  upload?: UploadImageAsset
  getCurrentSourceNodeUids?: () => readonly string[]
}): Promise<string[]> {
  const {
    store,
    graphId,
    sourceNodeUids,
    signal,
    upload,
    getCurrentSourceNodeUids,
  } = args
  const descriptors = captureReferenceSourceDescriptors({ store, graphId, sourceNodeUids })

  const assetUids: string[] = []
  try {
    for (const descriptor of descriptors) {
      signal?.throwIfAborted()
      const nodeId = asNodeId(descriptor.sourceNodeUid)
      if (descriptor.nodeType === "image") {
        if (descriptor.imageAssetUid) {
          assetUids.push(descriptor.imageAssetUid)
        } else {
          assetUids.push(await materializeImageNodeAsset({
            store,
            graphId,
            nodeId,
            signal,
            upload,
            expectedVersion: {
              src: descriptor.src,
              assetUid: null,
            },
          }))
        }
        continue
      }

      const current = store.getNode(nodeId)
      const currentData = (current?.data ?? {}) as NoteNodeData
      if (
        !current
        || current.type !== "image-generator"
        || currentData.graphUid !== graphId
        || readKeywordProperty(currentData.properties?.activeGenerationUid)
          !== descriptor.activeGenerationUid
      ) {
        throw new ImageReferenceResolutionError(IMAGE_REFERENCE_CHANGED_MESSAGE)
      }
      const generation = await getImageGeneration(
        graphId,
        descriptor.activeGenerationUid,
        signal,
      )
      const resolvedNode = store.getNode(nodeId)
      const resolvedData = (resolvedNode?.data ?? {}) as NoteNodeData
      if (
        !resolvedNode
        || resolvedNode.type !== "image-generator"
        || resolvedData.graphUid !== graphId
        || readKeywordProperty(resolvedData.properties?.activeGenerationUid)
          !== descriptor.activeGenerationUid
      ) {
        throw new ImageReferenceResolutionError(IMAGE_REFERENCE_CHANGED_MESSAGE)
      }
      if (generation.status !== "succeeded" || !isImageAssetUid(generation.output_asset_uid)) {
        throw new ImageReferenceResolutionError("참조 생성 노드에 완료된 이미지가 없습니다.")
      }
      assetUids.push(generation.output_asset_uid)
    }
  } catch (error) {
    if (error instanceof ImageReferenceVersionChangedError) {
      throw new ImageReferenceResolutionError(IMAGE_REFERENCE_CHANGED_MESSAGE)
    }
    if (error instanceof ImageReferenceMaterializationError) {
      throw new ImageReferenceResolutionError(error.message)
    }
    throw error
  }

  assertReferenceSourcesUnchanged({
    store,
    graphId,
    descriptors,
    assetUids,
    currentSourceNodeUids: getCurrentSourceNodeUids?.() ?? sourceNodeUids,
  })
  return assetUids
}
