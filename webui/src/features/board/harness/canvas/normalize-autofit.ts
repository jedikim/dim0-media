import type { CanvasStore, Node, OpBatch } from "@canvas-harness/core"
import { AUTOFIT_DISABLED_TYPES } from "../convert/note-to-node"


/**
 * Force `style.autoFit = false` on incoming custom-type nodes whose lib
 * grow-to-fit must stay off (sheet, code-sandbox, widget, mini-app,
 * generated-image, folder, document — they render bounded previews).
 *
 * Defense-in-depth mirroring the server's `note_to_wire` guard: an
 * agent-created sheet from an un-upgraded backend, or a replayed
 * catch-up batch, could arrive with `autoFit` unset (→ on in the lib),
 * and the next local content edit would then grow the node to fit the
 * whole markdown body, uncapped. The frontend converter (`note-to-node`)
 * already does this for snapshot / local-create paths; this covers the
 * remote-op path the same way `normalizeBatchColorsForLocalTheme` covers
 * colors.
 *
 * Mutates the batch in place — it is owned by the caller at this point
 * (decoded from JSON moments ago) and `attachSync` reads style after.
 */
export const normalizeBatchAutoFit = (batch: OpBatch, store: CanvasStore): void => {
  for (const op of batch.ops) {
    if (op.type === "node.add") {
      const node = op.node
      if (!AUTOFIT_DISABLED_TYPES.has(node.type)) continue
      node.style = { ...(node.style ?? {}), autoFit: false }
    } else if (op.type === "node.update") {
      const patch = op.patch as Partial<Node>
      // A style-bearing patch replaces the node's style on apply, so it
      // could silently re-enable autoFit; patches without `style` leave
      // the existing (already-correct) flag untouched.
      if (patch.style === undefined) continue
      const type = store.getNode(op.id)?.type ?? patch.type
      if (type === undefined || !AUTOFIT_DISABLED_TYPES.has(type)) continue
      patch.style = { ...patch.style, autoFit: false }
    }
  }
}
