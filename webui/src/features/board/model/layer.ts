/**
 * Per-layer (subspace) projection of board content.
 *
 * Mirrors the backend `get_graph(root_id)`: a board is a tree of layers linked by
 * `parentId`, and only one layer is visible at a time. The root layer is
 * `parentId == null`; entering a folder scopes to `parentId == folderId`.
 *
 * This is a *projection* for the live canvas store only — persistence stays
 * whole-board (the oplog/snapshot cover every layer), so filtering here can never
 * drop other layers.
 */
import type { BoardContent, DimNode } from "."


/** Normalise a parentId to its layer key (null = root layer). */
const layerOf = (parentId: string | null | undefined): string | null => parentId ?? null


/**
 * Keep only the nodes/edges in `rootId`'s layer (root layer when `rootId` is
 * null). Groups and frameOrder pass through unchanged — they're layout metadata,
 * not layer-scoped.
 */
export const filterContentByLayer = (content: BoardContent, rootId: string | null): BoardContent => {
  const target = rootId ?? null
  return {
    ...content,
    nodes: content.nodes.filter((n) => layerOf(n.data?.parentId) === target),
    edges: content.edges.filter((e) => layerOf(e.data?.parentId) === target),
  }
}


/** One step in a folder breadcrumb: a folder node's id and display label. */
export type LayerCrumb = { id: string; label: string }


/**
 * Build the folder breadcrumb from the root down to `rootId`, by walking the
 * `parentId` chain up from `rootId` over the whole board's nodes. Returns []
 * for the root layer. Cycle-safe. The local analog of the backend note-path.
 */
export const buildLayerPath = (nodes: DimNode[], rootId: string | null): LayerCrumb[] => {
  if (!rootId) return []
  const byId = new Map(nodes.map((n) => [n.id as string, n]))
  const path: LayerCrumb[] = []
  const seen = new Set<string>()
  let current: string | null = rootId
  while (current && !seen.has(current)) {
    seen.add(current)
    const node = byId.get(current)
    if (!node) break
    path.push({ id: current, label: node.data?.label?.trim() || "Folder" })
    current = node.data?.parentId ?? null
  }
  return path.reverse()
}
