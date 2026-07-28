import { useCallback, useState } from "react"
import { getCanvasStoreRef } from "@/features/board/harness/canvas-store-ref"
import { runAgent } from "@/features/agent/engine/agent-loop"
import { resolveAgentLlm } from "@/features/agent/engine/services/local-llm"
import { createNote, linkNotes, updateNote } from "@/features/agent/engine/tools"
import type { AgentEvent } from "@/features/agent/engine/types"
import { useByokStore } from "@/features/agent/byok/byok-store"


// v1 toolset: the build tools (create/update/link) over the local store.
// search_notes / list_boards land once their ctx (search/registry) is wired.
const BUILD_TOOLS = [createNote, updateNote, linkNotes]


/** Run the frontend agent against the live local board via BYOK. */
export function useLocalAgent() {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const asConfig = useByokStore((s) => s.asConfig)

  const send = useCallback(
    async (prompt: string): Promise<void> => {
      const store = getCanvasStoreRef()
      if (!store) {
        setError("No active board.")
        return
      }
      const config = asConfig()
      if (!config) {
        setError("Set your API key first.")
        return
      }
      setError(null)
      setRunning(true)
      setEvents([])
      try {
        const llm = resolveAgentLlm(config, { signedIn: false })
        if (!llm) {
          setError("Set your API key first.")
          return
        }
        for await (const ev of runAgent({ userMessage: prompt, tools: BUILD_TOOLS, llm, ctx: { store } })) {
          setEvents((prev) => [...prev, ev])
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setRunning(false)
      }
    },
    [asConfig],
  )

  return { events, running, error, send }
}
