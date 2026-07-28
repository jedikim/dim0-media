/**
 * LLM acquisition for the client agent, routed through the service resolver.
 *
 * G2: managed transport is live. A signed-in user with no BYOK key resolves to
 * the managed LLM (our keys, server-resolved model + tiers); a BYOK key wins by
 * default; signed-out with no key is off. The agent loop downstream is unchanged
 * — it just receives an `LlmClient`.
 */
import type { ByokConfig } from "../byok-client"
import type { LlmClient } from "../types"
import { managedLlmClient } from "../managed-client"
import { llmClientFromResolution } from "./clients"
import { agentResolveContext } from "./context"
import { resolveService } from "./resolve"


export type AgentLlmOptions = {
  signedIn: boolean
  runId?: string
  /** Selected catalog model for the MANAGED path (canonical id); "auto"/undefined
   *  lets the server route. */
  model?: string
  /** Selected model translated to the BYOK provider's model string (from the
   *  catalog routes); overrides the config's model on the BYOK-direct path. */
  byokModel?: string
}


/**
 * Build the agent's LLM client from a BYOK config + auth, via the resolver.
 * "Our keys first": signed in → managed even with a saved key; signed out → the
 * saved key (BYOK), or null when there's neither. `opts.model` picks the managed
 * catalog model; `opts.byokModel` picks the model on the BYOK-direct path.
 */
export const resolveAgentLlm = (
  config: ByokConfig | null,
  opts: AgentLlmOptions,
): LlmClient | null => {
  const llm = config && opts.byokModel ? { ...config, model: opts.byokModel } : config
  const resolution = resolveService("llm", agentResolveContext({ signedIn: opts.signedIn, llm }))
  return llmClientFromResolution(resolution, (r) =>
    managedLlmClient(opts.model ?? r.model ?? "auto", { runId: opts.runId }),
  )
}
