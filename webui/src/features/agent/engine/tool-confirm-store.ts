import { create } from "zustand"
import type { ToolConfirmDecision } from "./types"


// Re-exported so existing importers keep their path; canonical home is types.ts.
export type { ToolConfirmDecision } from "./types"


/** A pending request to run an off-board tool, awaiting the user's decision. */
export type ToolConfirmRequest = { name: string; args: Record<string, unknown> }


type Pending = (ToolConfirmRequest & { resolve: (decision: ToolConfirmDecision) => void }) | null


type ToolConfirmState = {
  pending: Pending
  /** Ask the user to approve a tool run; resolves with their decision. */
  request: (req: ToolConfirmRequest) => Promise<ToolConfirmDecision>
  /** Settle the pending request (from the confirm UI). No-op if nothing pending. */
  resolve: (decision: ToolConfirmDecision) => void
}


/**
 * Bridges the agent loop's `confirmTool` gate (see agent-loop `CONFIRM_TOOLS`)
 * to a React confirm dialog: `request` parks a promise + the pending request so
 * a mounted `<ToolConfirmDialog>` can render it, and `resolve` settles it. The
 * loop `await`s the promise, so a run pauses on the prompt.
 */
export const useToolConfirm = create<ToolConfirmState>((set, get) => ({
  pending: null,
  request: (req) => {
    // One prompt at a time. If one is already open (a second/concurrent run),
    // decline the NEW request rather than clobbering the prompt the user is
    // deciding on — fail closed without disturbing the in-flight decision.
    if (get().pending) return Promise.resolve("deny")
    return new Promise<ToolConfirmDecision>((resolve) => set({ pending: { ...req, resolve } }))
  },
  resolve: (decision) => {
    const p = get().pending
    if (!p) return
    p.resolve(decision)
    set({ pending: null })
  },
}))


/**
 * Decide a confirm outcome without touching the UI. A standing per-tool grant
 * (`isAutoAllowed`) short-circuits to `once` — run this call but do NOT record it
 * in the run's approved set, so the grant is re-checked on every call and
 * toggling it off mid-run takes effect on the very next call. Otherwise defer to
 * the dialog. Kept as a pure function (ports injected) so it's unit-testable
 * away from the submit hook.
 */
export const resolveConfirmDecision = (
  toolName: string,
  isAutoAllowed: (tool: string) => boolean,
  askDialog: () => Promise<ToolConfirmDecision>,
): Promise<ToolConfirmDecision> =>
  isAutoAllowed(toolName) ? Promise.resolve("once") : askDialog()
