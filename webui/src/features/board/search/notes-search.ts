/**
 * Whole-board search rows for the notes palette. The live index mirrors only the
 * current layer, so the palette reads the whole board (via BoardPersistence) and
 * turns it into rows the command palette filters. Each row carries the note's
 * layer (`parentId`) + folder breadcrumb so a result can jump across layers.
 */
import type { DimNode } from "@/features/board/model"
import { buildLayerPath } from "@/features/board/model/layer"


export type SearchRow = {
  id: string
  title: string
  /** Folder path of the note's layer, e.g. "Alpha / Beta" ("" at the root). */
  crumb: string
  /** The note's layer (its containing folder), null at the root. */
  parentId: string | null
  /** Text the palette filters against (title + body + id). */
  value: string
}


/** A note's display title: its label, else a body snippet, else "Untitled". */
const titleOf = (node: DimNode): string => {
  const label = node.data?.label?.trim() ?? ""
  if (label) return label
  const body = (node.content ?? "").trim().replace(/\s+/g, " ")
  return body.slice(0, 60) || "Untitled"
}


/** Turn whole-board nodes into palette rows (breadcrumb resolved per node). */
export const toSearchRows = (nodes: DimNode[]): SearchRow[] =>
  nodes.map((node) => {
    const title = titleOf(node)
    const parentId = node.data?.parentId ?? null
    const crumb = buildLayerPath(nodes, parentId).map((c) => c.label).join(" / ")
    return { id: node.id, title, crumb, parentId, value: `${title} ${node.content ?? ""} ${node.id}` }
  })
