import type { Node, Style as CanvasStyle } from "@canvas-harness/core"
import type { NoteNodeData } from "../convert/note-to-node"
import { adaptNodeColors, applyColorsToStyle, type StoredColors } from "./color-adapter"
import type { Mode } from "./tokens"


/**
 * Lift the source-of-truth (light-space) colors off a Node, falling back
 * to the painted `node.style` for legacy nodes that predate
 * `data._storedColors`.
 */
export const storedNodeColorsOf = (node: Node): StoredColors => {
  const data = node.data as Partial<NoteNodeData> | undefined
  return (
    data?._storedColors ?? {
      backgroundColor: node.style?.backgroundColor,
      strokeColor: node.style?.strokeColor,
      textColor: node.style?.textColor,
    }
  )
}


/**
 * Compute the `{ style, data }` patch for a node color change, keeping
 * `data._storedColors` (the canonical light-space colors the server
 * stores) and the painted `node.style` (theme-projected) in sync.
 *
 * Shared by the style panel and the sheet background picker so the two
 * can never drift on how a color round-trips through a theme flip.
 * `baseStyle` lets callers fold non-color style changes in first; it
 * defaults to the node's current style.
 */
export const computeNodeColorUpdate = (
  node: Node,
  colorPatch: Partial<StoredColors>,
  mode: Mode,
  baseStyle?: CanvasStyle,
): { style: CanvasStyle; data: NoteNodeData } => {
  const nextStored: StoredColors = { ...storedNodeColorsOf(node), ...colorPatch }
  const displayColors = mode === "dark" ? adaptNodeColors(nextStored, "dark") : nextStored
  const style = applyColorsToStyle(baseStyle ?? node.style ?? {}, displayColors)
  const data: NoteNodeData = {
    ...((node.data ?? {}) as NoteNodeData),
    _storedColors: nextStored,
  }
  return { style, data }
}
