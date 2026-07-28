import { create } from "zustand"


/** A pending request to run an off-board tool, awaiting the user's decision. */
export type ToolConfirmRequest = { name: string; args: Record<string, unknown> }


type Pending = (ToolConfirmRequest & { resolve: (ok: boolean) => void }) | null


type ToolConfirmState = {
  pending: Pending
  /** Ask the user to approve a tool run; resolves true (run) / false (decline). */
  request: (req: ToolConfirmRequest) => Promise<boolean>
  /** Settle the pending request (from the confirm UI). No-op if nothing pending. */
  resolve: (ok: boolean) => void
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
    if (get().pending) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => set({ pending: { ...req, resolve } }))
  },
  resolve: (ok) => {
    const p = get().pending
    if (!p) return
    p.resolve(ok)
    set({ pending: null })
  },
}))
