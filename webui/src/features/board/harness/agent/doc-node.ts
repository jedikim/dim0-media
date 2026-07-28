/**
 * Represent an uploaded document as a single `document` node on the canvas
 * (F2 — doc node). NOT a mindmap: exactly one node per document, whose id IS the
 * `docId`, so delete/override/citation all key off the same id. The node is a
 * lightweight pointer — its markdown/chunks live in `DocRepo`.
 *
 * Built by running a dim0 `Note` (type "document") through the shared
 * `convertNoteToNode`, so the harness node's data shape is exactly what
 * `DocumentView` renders (label + "completed" status) and round-trips cleanly.
 */
import { asNodeId, type CanvasStore } from "@canvas-harness/core"
import { createDefaultNote } from "@/features/board/types/note"
import { noteToNode } from "@/features/board/harness/convert/note-to-node"
import { makeBatch } from "@/features/board/harness/make-batch"
import { beneathBorderOrigin } from "./beneath-border"


/**
 * Add a `document` node (id = docId) for an uploaded file, placed beneath the
 * current graph border. No-op if the node already exists (same-name override
 * keeps the id and the placed node — only the doc's chunks changed).
 */
export const addDocumentNode = (
  store: CanvasStore,
  opts: { docId: string; title: string; boardId: string; rootId?: string | null },
): void => {
  const id = asNodeId(opts.docId)
  if (store.getNode(id)) return // already on the canvas (override reuses the id)

  const note = createDefaultNote({ boardId: opts.boardId, nodeType: "rectangle" })
  note.id = opts.docId
  note.type = "document"
  note.label = { markdown: opts.title }
  note.properties.status = { type: "keyword", value: "completed" }
  if (opts.rootId) note.parentId = opts.rootId

  const node = noteToNode(note)
  const at = beneathBorderOrigin(store)
  // Non-undoable create (`history` origin): a document owns markdown + chunks in
  // DocRepo, so undoing the upload can't losslessly restore it — keep it off the
  // undo stack, mirroring the durable delete (see DURABLE_DELETE).
  store.applyBatch(makeBatch(store, "history", [{ type: "node.add", node: { ...node, id, x: at.x, y: at.y } }]))
}
