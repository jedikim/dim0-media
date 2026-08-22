import { asNodeId, type CanvasStore } from "@canvas-harness/core"

import { getImageGeneration } from "@/features/board/api/image-generation"
import type { NoteNodeData } from "./convert/note-to-node"
import {
  isImageAssetUid,
  materializeImageNodeAsset,
  type UploadImageAsset,
} from "./image-reference-assets"
import { readKeywordProperty } from "./node-types/image-generator/node-state"


/** Marker for fixed client-side reference resolution messages. */
export class ImageReferenceResolutionError extends Error {}


/** Resolve ordered canvas sources into immutable asset UIDs without provider work. */
export async function resolveReferenceAssetUids(args: {
  store: CanvasStore
  graphId: string
  sourceNodeUids: readonly string[]
  signal?: AbortSignal
  upload?: UploadImageAsset
}): Promise<string[]> {
  const { store, graphId, sourceNodeUids, signal, upload } = args
  if (new Set(sourceNodeUids).size !== sourceNodeUids.length) {
    throw new ImageReferenceResolutionError("같은 참조 노드를 두 번 연결할 수 없습니다.")
  }

  const assetUids: string[] = []
  for (const sourceNodeUid of sourceNodeUids) {
    signal?.throwIfAborted()
    const nodeId = asNodeId(sourceNodeUid)
    const node = store.getNode(nodeId)
    const data = (node?.data ?? {}) as NoteNodeData
    if (!node || data.graphUid !== graphId) {
      throw new ImageReferenceResolutionError("참조 노드를 이 보드에서 사용할 수 없습니다.")
    }

    if (node.type === "image") {
      assetUids.push(await materializeImageNodeAsset({
        store,
        graphId,
        nodeId,
        signal,
        upload,
      }))
      continue
    }
    if (node.type !== "image-generator") {
      throw new ImageReferenceResolutionError("지원하지 않는 참조 노드입니다.")
    }

    const activeGenerationUid = readKeywordProperty(data.properties?.activeGenerationUid)
    if (!activeGenerationUid) {
      throw new ImageReferenceResolutionError("참조 생성 노드에 완료된 이미지가 없습니다.")
    }
    const generation = await getImageGeneration(graphId, activeGenerationUid, signal)
    if (generation.status !== "succeeded" || !isImageAssetUid(generation.output_asset_uid)) {
      throw new ImageReferenceResolutionError("참조 생성 노드에 완료된 이미지가 없습니다.")
    }
    assetUids.push(generation.output_asset_uid)
  }
  return assetUids
}
