import { useCallback } from "react"
import type { CanvasStore, Node } from "@canvas-harness/core"
import type { CanvasCreateDragEvent, CanvasPointerEvent } from "@canvas-harness/react"
import { createDefaultNote } from "@/features/board/types/note"
import { canvasTypeToDim0 } from "../convert/node-type"
import { noteToNode, type NoteNodeData } from "../convert/note-to-node"
import {
  adaptNodeColors,
  applyColorsToStyle,
  pickStoredColors,
} from "../theme/color-adapter"
import { getBoardThemeMode } from "../theme/theme-mode-ref"
import { isStylableNodeType, type StyleMemoryApi } from "./use-style-memory"


/** Tools that materialize a new node on drag-to-create / click-to-create. */
const SHAPE_TOOLS = new Set([
  "rect",
  "ellipse",
  "diamond",
  "tag",
  "capsule",
  "thought-cloud",
  "layered-rect",
  "layered-ellipse",
  "layered-diamond",
  "soft-diamond",
  "text",
  "frame",
  // Custom node types — go through the same convert + addNode path
  // (createDefaultNote handles their default sizes / styles per type).
  "folder",
  "sheet",
  "code-sandbox",
  "widget",
])


const isShapeTool = (tool: string): boolean => SHAPE_TOOLS.has(tool)


/**
 * Subset of shape tools where a bare click (no drag) still places a
 * node. Click-to-place is the established UX for text and for fixed-
 * size surfaces (folders / sheets / code-sandboxes / widgets); the
 * resizable shapes (rect, ellipse, diamond, …) require an actual
 * drag — sub-5px drags fall through to onClick as a no-op so
 * accidental taps don't litter the canvas with default-size shapes.
 */
const CLICK_PLACE_TOOLS = new Set([
  "text",
  "folder",
  "sheet",
  "code-sandbox",
  "widget",
])


/**
 * Fold the user's sticky style memory into a freshly-converted Node
 * for stylable tool types. Custom node types and frames are excluded
 * so they keep their built-in visual identity.
 *
 * Memory holds stored colors (the user's pick); we merge them, then
 * project for the current theme mode before assigning to `node.style`.
 * `data._storedColors` is refreshed so save round-trips the picked
 * colors, not their dark-mode shadows.
 */
export const applyStyleMemory = (node: Node, styleMemory: StyleMemoryApi): Node => {
  if (!isStylableNodeType(node.type)) return node
  if (node.type === "frame") return node
  const remembered = styleMemory.getNodeStyle()
  if (!remembered) return node

  // Merge memory onto the default style in stored-color space first.
  const mergedStored = { ...node.style, ...remembered }
  const storedColors = pickStoredColors(mergedStored)
  const mode = getBoardThemeMode()
  const displayColors = mode === "dark" ? adaptNodeColors(storedColors, "dark") : storedColors

  const nextData: NoteNodeData = {
    ...((node.data ?? {}) as NoteNodeData),
    _storedColors: storedColors,
  }
  return {
    ...node,
    style: applyColorsToStyle(mergedStored, displayColors),
    data: nextData,
  }
}


/**
 * onCreateDrag / onClick handlers for `<Canvas>`. Routes shape-tool
 * gestures into the conversion layer:
 *
 *   1. Build a fresh Dim0 Note via `createDefaultNote` so it carries
 *      the right default style + properties for round-trip persistence.
 *   2. Override its `nodePosition` / `nodeSize` from the gesture rect
 *      (drag) or the world click (click + default size).
 *   3. Convert to a canvas-harness Node and merge the user's sticky
 *      style memory before adding to the store.
 *
 * Select, pan, and arrow tools are handled by the lib internally — we
 * skip them here.
 */
export const useCreateHandlers = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
  styleMemory: StyleMemoryApi,
): {
  handleCreateDrag: (e: CanvasCreateDragEvent) => void
  handleClick: (e: CanvasPointerEvent) => void
} => {
  const handleCreateDrag = useCallback(
    (e: CanvasCreateDragEvent): void => {
      if (!isShapeTool(e.tool)) return
      const dim0Type = canvasTypeToDim0(e.tool)
      const note = createDefaultNote({ boardId: boardId ?? "", nodeType: dim0Type })
      if (rootId) note.parentId = rootId
      note.properties.nodePosition = {
        type: "position",
        position: { x: e.rect.x, y: e.rect.y },
      }
      note.properties.nodeSize = {
        type: "size",
        size: { width: e.rect.w, height: e.rect.h },
      }
      // Auto-select the freshly-created node so the user can
      // immediately resize / style / move it without round-tripping
      // through the select tool. Matches tldraw / excalidraw /
      // figma. Same pattern at every single-node create path.
      const id = store.addNode(applyStyleMemory(noteToNode(note), styleMemory))
      store.setSelection([id])
    },
    [store, boardId, rootId, styleMemory],
  )

  const handleClick = useCallback(
    (e: CanvasPointerEvent): void => {
      if (!CLICK_PLACE_TOOLS.has(e.tool)) return
      const dim0Type = canvasTypeToDim0(e.tool)
      const note = createDefaultNote({ boardId: boardId ?? "", nodeType: dim0Type })
      if (rootId) note.parentId = rootId
      const size = note.properties.nodeSize.size ?? { width: 200, height: 120 }
      const { width, height } = size
      note.properties.nodePosition = {
        type: "position",
        position: { x: e.world.x - width / 2, y: e.world.y - height / 2 },
      }
      const id = store.addNode(applyStyleMemory(noteToNode(note), styleMemory))
      store.setSelection([id])
    },
    [store, boardId, rootId, styleMemory],
  )

  return { handleCreateDrag, handleClick }
}
