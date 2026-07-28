/**
 * Node types whose deletion is DURABLE — not undoable, and confirmed first.
 *
 * These nodes own state outside the canvas store (a document's markdown +
 * chunks in `DocRepo`; a folder's whole subtree, which cascades). Undoing such
 * a delete can't losslessly restore that external state, so we take the delete
 * off the undo stack (apply it as `history` origin) and gate it behind a
 * confirm dialog instead. This map is the single source of truth for both:
 * add an entry to make a new node type durable + confirmed on delete.
 */
export type DurableDeleteMeta = { title: string; description: string }


export const DURABLE_DELETE: Record<string, DurableDeleteMeta> = {
  folder: {
    title: "Delete this folder?",
    description: "Its contents are removed from the board. This can't be undone.",
  },
  document: {
    title: "Delete this document?",
    description: "It's removed from the board along with its Q&A content. This can't be undone.",
  },
}


/** True when a node of `type` deletes durably (non-undoable, confirmed). */
export const isDurableDelete = (type?: string | null): boolean =>
  !!type && Object.prototype.hasOwnProperty.call(DURABLE_DELETE, type)
