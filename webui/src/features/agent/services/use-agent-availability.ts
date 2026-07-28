import { useIsSignedIn } from "@/lib/auth"
import { useByokStore } from "@/features/agent/byok/byok-store"


/**
 * Whether the agent has a usable model right now — the gate for running at all.
 * True when signed in (our managed keys) or a BYOK model key is set (direct).
 * Mirrors `resolveAgentLlm(...) !== null` without building a client, so UI (the
 * floating island) can reflect availability reactively.
 */
export const useHasUsableModel = (): boolean => {
  const signedIn = useIsSignedIn()
  const configured = useByokStore((s) => s.configured)
  return signedIn || configured
}
