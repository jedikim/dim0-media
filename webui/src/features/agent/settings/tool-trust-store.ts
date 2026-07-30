import { create } from "zustand"
import { CONFIRM_TOOL_NAMES, type ConfirmToolName } from "@/features/agent/engine/types"


// Re-exported so settings-dialog keeps importing it from here; canonical in types.ts.
export type { ConfirmToolName } from "@/features/agent/engine/types"


/**
 * Persistent, device-local trust preferences for the off-board tool confirm
 * gate. Kept separate from `byok-store` on purpose: this must persist even with
 * no BYOK key set (managed web search / fetch are the common case), whereas
 * byok-store only writes localStorage when a key exists.
 *
 * Each `autoAllow[tool]` is a standing "always allow" grant surfaced in Settings
 * — a deliberate, revocable opt-in that skips the per-call prompt across runs
 * for that ONE tool. Per-tool on purpose: trusting web search shouldn't silently
 * trust code execution.
 */

const STORAGE_KEY = "dim0.tool_trust"


const ALL_OFF = (): Record<ConfirmToolName, boolean> =>
  Object.fromEntries(CONFIRM_TOOL_NAMES.map((n) => [n, false])) as Record<ConfirmToolName, boolean>


/**
 * Read the persisted grant map from localStorage, tolerant of a missing,
 * corrupt, or partial payload (each missing/garbage field defaults to off).
 * Derives the tool set from `CONFIRM_TOOL_NAMES`, so a new gated tool is covered
 * automatically. Exported for testing the rehydration path. Never throws.
 */
export const loadToolTrust = (): Record<ConfirmToolName, boolean> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return ALL_OFF()
    const parsed = JSON.parse(raw) as Partial<Record<ConfirmToolName, boolean>>
    return Object.fromEntries(
      CONFIRM_TOOL_NAMES.map((n) => [n, Boolean(parsed[n])]),
    ) as Record<ConfirmToolName, boolean>
  } catch {
    return ALL_OFF()
  }
}


type ToolTrustState = {
  autoAllow: Record<ConfirmToolName, boolean>
  /** True when `tool` has a standing grant (safe to pass any tool name). */
  isAutoAllowed: (tool: string) => boolean
  /** Toggle a tool's standing grant and persist it on this device. */
  setAutoAllow: (tool: ConfirmToolName, on: boolean) => void
}


export const useToolTrustStore = create<ToolTrustState>((set, get) => ({
  autoAllow: loadToolTrust(),
  isAutoAllowed: (tool) => Boolean((get().autoAllow as Record<string, boolean>)[tool]),
  setAutoAllow: (tool, on) => {
    const autoAllow = { ...get().autoAllow, [tool]: on }
    set({ autoAllow })
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(autoAllow))
    } catch {
      // storage unavailable — the preference stays in-memory for this session
    }
  },
}))
