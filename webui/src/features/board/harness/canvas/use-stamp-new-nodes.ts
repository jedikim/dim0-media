import { useEffect } from "react"
import { type CanvasStore } from "@canvas-harness/core"
import { AUTOFIT_DISABLED_TYPES, type NoteNodeData } from "../convert/note-to-node"
import {
  adaptNodeColors,
  applyColorsToStyle,
  type StoredColors,
} from "../theme/color-adapter"
import { getBoardThemeMode } from "../theme/theme-mode-ref"


/**
 * Stamp `data.graphUid` / `data.parentId` to current scope, re-project
 * display colors from `_storedColors` for the current theme, AND force
 * `autoFit:false` on custom-type nodes (sheet/mini-app/…) — on every
 * local `node.add`. The catch-all for local-create emitters that don't
 * go through `noteToNode` (notably the agent's `write_note`).
 *
 * Three sources produce a local `node.add`:
 *
 *   1. Tool-drawn note — `noteToNode` in `use-create-handlers` already
 *      stamps current scope and projects style for current theme.
 *      Both checks match → early-exit.
 *   2. Pasted note — canvas-harness's clipboard preserves source
 *      `data` and `style` verbatim. Without our rewrite:
 *        - `graphUid`/`parentId` point at the SOURCE — on refresh
 *          the target board's REST query filters it out (note
 *          "disappears", reappears in source).
 *        - `style.{bg,stroke,text}Color` are display values from the
 *          source's theme at copy-time. If the user copied in one
 *          theme and pasted in another (e.g. light→dark toggle
 *          between copy and paste, even same-board same-folder), the
 *          rendered colors won't match the canvas mode.
 *   3. Agent mindmap drain (`use-harness-apply-mindmap`) — pre-stamps
 *      scope and routes through `noteToNode` (which projects style
 *      for current theme). Both checks match → early-exit.
 *
 * Hydrated / agent-remote nodes arrive with `origin === "remote"` and
 * are filtered out by the batch-origin check.
 *
 * Invariant for future contributors: any new emitter of a local
 * `node.add` must either pre-stamp scope + project style for the
 * current theme (like the mindmap drain) or accept being rewritten
 * here.
 *
 * Tree-paste is flattened: folder copy is blocked at the keydown layer
 * (`use-block-folder-copy`), so we never have to remap descendant
 * `parentId` references on paste.
 */
export const useStampNewNodes = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
): void => {
  useEffect(() => {
    if (!boardId) return
    return store.subscribe("change", (batch) => {
      if (batch.origin !== "local") return
      for (const op of batch.ops) {
        if (op.type !== "node.add") continue
        const data = (op.node.data ?? {}) as NoteNodeData & Record<string, unknown>

        const wantedParentId = rootId ?? undefined
        const needsRescope =
          data.graphUid !== boardId || data.parentId !== wantedParentId

        // Theme staleness check: a pasted node carries `_storedColors`
        // (canonical, theme-independent) and `style.*` (display, baked
        // for whatever theme was active at copy-time). If the derived
        // display for the CURRENT theme doesn't match `style.*`, the
        // node would paint in the wrong palette until the next theme
        // toggle re-projects it.
        const stored = data._storedColors as StoredColors | undefined
        const currentStyle = op.node.style ?? {}
        let nextStyle: typeof currentStyle | null = null
        if (stored) {
          const mode = getBoardThemeMode()
          const display = mode === "dark" ? adaptNodeColors(stored, "dark") : stored
          if (
            currentStyle.backgroundColor !== display.backgroundColor ||
            currentStyle.strokeColor !== display.strokeColor ||
            currentStyle.textColor !== display.textColor
          ) {
            nextStyle = applyColorsToStyle(currentStyle, display)
          }
        }

        // Custom types render only a PREVIEW of node.content, so the lib's
        // grow-to-fit must stay off — otherwise the node grows to the whole
        // body. noteToNode / normalizeBatchAutoFit do this on the snapshot +
        // remote paths; this covers local-create emitters (e.g. the agent's
        // write_note, which addNode()s directly without a style).
        if (AUTOFIT_DISABLED_TYPES.has(op.node.type) && currentStyle.autoFit !== false) {
          nextStyle = { ...(nextStyle ?? currentStyle), autoFit: false }
        }

        if (!needsRescope && !nextStyle) continue

        const patch: Parameters<typeof store.updateNode>[1] = {}
        if (needsRescope) {
          patch.data = { ...data, graphUid: boardId, parentId: wantedParentId }
        }
        if (nextStyle) patch.style = nextStyle
        store.updateNode(op.node.id, patch)
      }
    })
  }, [store, boardId, rootId])
}
