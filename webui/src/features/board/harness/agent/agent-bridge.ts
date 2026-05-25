import type { LinkNotesOutput } from "@/features/agent/types/tool-outputs"
import type { ApplyNoteResult, NoteToolOutput } from "./apply-tool-output"


/**
 * Module-level bridge so the agent's `sendMessage` mutation (which
 * lives outside the canvas component tree) can apply tool outputs to
 * the harness store without importing it directly.
 *
 * `HarnessCanvas` registers a bridge instance on mount that has the
 * store + queryClient + boardId + rootId baked into closures. The
 * agent's post-stream apply block calls into the registered bridge.
 *
 * Mirrors the existing `setBoardNavigate` / `setNodeSurfaceNavigator`
 * patterns.
 */
export type AgentBridge = {
  /** Apply a note tool output (create / write / edit). Returns null when skipped. */
  applyNoteOutput: (output: NoteToolOutput) => Promise<ApplyNoteResult | null>
  /** Apply a link tool output. Returns the linkId on success, null when skipped. */
  applyLinkOutput: (output: LinkNotesOutput) => Promise<string | null>
}


let _bridge: AgentBridge | null = null


export const setAgentBridge = (bridge: AgentBridge | null): void => {
  _bridge = bridge
}


export const getAgentBridge = (): AgentBridge | null => _bridge
