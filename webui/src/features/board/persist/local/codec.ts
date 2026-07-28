/**
 * Content codec (A1) — the seam between dim0's `BoardContent` and the
 * canvas-harness scene. Because the persisted model IS the canvas-harness scene,
 * these are near-identity: arrays of nodes/edges/groups, with camera/selection
 * (per-device view state) defaulted in and stripped out.
 */
import { SCHEMA_VERSION, fromSerialized } from "@canvas-harness/core"
import type { CanvasStore, Scene, SerializedScene } from "@canvas-harness/core"
import type { BoardContent, DimEdge, DimNode } from "@/features/board/model"


const DEFAULT_CAMERA = { x: 0, y: 0, z: 1 }


/** An empty board's content. */
export const emptyContent = (): BoardContent => ({
  schemaVersion: SCHEMA_VERSION,
  nodes: [],
  edges: [],
  groups: [],
})


/** Read shared content out of a live store (excludes camera/selection). */
export const readContent = (store: CanvasStore): BoardContent => ({
  schemaVersion: SCHEMA_VERSION,
  nodes: store.getAllNodes() as DimNode[],
  edges: store.getAllEdges() as DimEdge[],
  groups: store.getAllGroups(),
  frameOrder: store.getFrames().map((f) => f.id),
})


/** Build a hydratable canvas-harness Scene from stored content. */
export const contentToScene = (content: BoardContent): Scene =>
  fromSerialized({
    schemaVersion: content.schemaVersion,
    nodes: content.nodes,
    edges: content.edges,
    groups: content.groups,
    camera: DEFAULT_CAMERA,
    selection: [],
    ...(content.frameOrder && content.frameOrder.length > 0
      ? { frameOrder: content.frameOrder }
      : {}),
  } satisfies SerializedScene)
