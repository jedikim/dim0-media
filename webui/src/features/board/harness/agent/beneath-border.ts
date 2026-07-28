import type { CanvasStore } from "@canvas-harness/core"


// Gap between existing board content and freshly-added notes. Matches the
// backend's DEFAULT_NOTE_GAP (notes/service.py) so local and server placement
// agree.
export const NOTE_TAIL_GAP = 80


type XY = { x: number; y: number }


/**
 * Top-left origin just beneath the current graph's border: left-aligned to the
 * leftmost node, one gap below the lowest bottom edge. `(0, 0)` on an empty
 * board. Frontend analog of the backend's `compute_note_position`
 * (min existing x, max existing bottom + gap).
 */
export const beneathBorderOrigin = (store: CanvasStore): XY => {
  const nodes = store.getAllNodes()
  if (nodes.length === 0) return { x: 0, y: 0 }
  const x = Math.min(...nodes.map((n) => n.x))
  const y = Math.max(...nodes.map((n) => n.y + n.h)) + NOTE_TAIL_GAP
  return { x, y }
}
