/**
 * Phase 3 rollout flag — run the in-browser agent engine on SYNCED boards too,
 * not just local-only ones. When on, a synced board's chat uses the browser
 * engine (edits ride the v2 relay to peers) instead of the server agent.
 *
 * Off by default → zero effect (synced boards keep the backend agent). Toggle
 * from the dev console: `dim0LocalAgent.on()` then reload. Graduates to a proper
 * rollout gate (v2-only) as Phase 3 lands.
 */
const KEY = "dim0_local_agent_on_synced"


/** Whether synced-board chat should run on the browser engine. */
export const isLocalAgentOnSynced = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}


const set = (on: boolean): void => {
  try {
    if (on) localStorage.setItem(KEY, "1")
    else localStorage.removeItem(KEY)
  } catch {
    // ignore — private mode / storage disabled just means the flag doesn't stick
  }
}


// Dev console bridge.
if (typeof window !== "undefined") {
  ;(window as unknown as { dim0LocalAgent?: unknown }).dim0LocalAgent = {
    on: () => set(true),
    off: () => set(false),
    enabled: () => isLocalAgentOnSynced(),
  }
}
