import { asNodeId, type CanvasStore } from "@canvas-harness/core"

import { getImageGeneration } from "@/features/board/api/image-generation"
import type { NoteNodeData } from "./convert/note-to-node"
import {
  IMAGE_REFERENCE_CHANGED_MESSAGE,
  IMAGE_REFERENCE_BOARD_UNAVAILABLE_MESSAGE,
  ImageReferenceMaterializationError,
  ImageReferenceVersionChangedError,
  isImageAssetUid,
  materializeImageNodeAsset,
  readImageAssetUid,
  type UploadImageAsset,
} from "./image-reference-assets"
import { readKeywordProperty } from "./node-types/image-generator/node-state"
import { readGeneratedImageAssociation } from "./node-types/generated-image/node-state"


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
  | {
      nodeType: "generated-image"
      generationUid: string
      generatorNodeUid: string
      imageAssetUid: string
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
    throw new ImageReferenceResolutionError("The same reference node cannot be connected twice.")
  }

  return sourceNodeUids.map((sourceNodeUid) => {
    const node = store.getNode(asNodeId(sourceNodeUid))
    const data = (node?.data ?? {}) as NoteNodeData & { src?: unknown }
    if (!node || data.graphUid !== graphId) {
      throw new ImageReferenceResolutionError(IMAGE_REFERENCE_BOARD_UNAVAILABLE_MESSAGE)
    }
    if (node.type === "image-generator") {
      const activeGenerationUid = readKeywordProperty(data.properties?.activeGenerationUid)
      if (!activeGenerationUid) {
        throw new ImageReferenceResolutionError("The reference generator has no completed image.")
      }
      return {
        sourceNodeUid,
        graphUid: graphId,
        nodeType: "image-generator" as const,
        activeGenerationUid,
      }
    }
    if (node.type === "generated-image") {
      const association = readGeneratedImageAssociation(data.properties ?? {})
      if (!association) {
        throw new ImageReferenceResolutionError("This generated image result cannot be used as a reference.")
      }
      return {
        sourceNodeUid,
        graphUid: graphId,
        nodeType: "generated-image" as const,
        generationUid: association.generationUid,
        generatorNodeUid: association.generatorNodeUid,
        imageAssetUid: association.assetUid,
      }
    }
    if (node.type !== "image") {
      throw new ImageReferenceResolutionError("This reference node type is not supported.")
    }

    const imageAssetUid = readImageAssetUid(data.properties?.imageAssetUid)
    const src = typeof data.src === "string" ? data.src : null
    if (!imageAssetUid && !src) {
      throw new ImageReferenceResolutionError("This image node cannot be registered as a reference asset.")
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

    if (descriptor.nodeType === "generated-image") {
      const association = readGeneratedImageAssociation(data.properties ?? {})
      if (
        !association
        || association.assetUid !== descriptor.imageAssetUid
        || association.generationUid !== descriptor.generationUid
        || association.generatorNodeUid !== descriptor.generatorNodeUid
        || assetUids[index] !== descriptor.imageAssetUid
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
      if (descriptor.nodeType === "generated-image") {
        assetUids.push(descriptor.imageAssetUid)
        continue
      }
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
        throw new ImageReferenceResolutionError("The reference generator has no completed image.")
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
