import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { asNodeId } from "@canvas-harness/core"
import { runAgent } from "@/features/agent/engine/agent-loop"
import { agentBuildTools } from "@/features/agent/engine/tools"
import type { AgentEvent } from "@/features/agent/engine/types"
import { saveMessages, loadMessages } from "@/features/agent/store/chat-persist"
import type { ChatMessage } from "@/features/agent/types/chat"
import { arrangeCreatedNodes } from "@/features/board/harness/agent/arrange-created-nodes"
import { readContent } from "@/features/board/persist/local/codec"
import { applyContentToStore } from "@/features/board/persist/local/apply-content"
import { darkModeDisplayHex } from "@/features/board/lib/colors/dark-variants"
import { getBoardThemeMode, setBoardThemeMode } from "@/features/board/harness/theme/theme-mode-ref"
import { freshStore, resetIdb } from "@/test/canvas"
import { ScriptedLlm, toolTurn } from "@/test/llm"


// One mindmap turn: root + three children, each linked from the root.
const mindmapScript = () =>
  new ScriptedLlm([
    toolTurn("write_note", { note_id: "root", content: "Root", note_type: "rectangle" }),
    toolTurn("write_note", { note_id: "c1", content: "Child one", note_type: "rectangle" }),
    toolTurn("write_note", { note_id: "c2", content: "Child two", note_type: "rectangle" }),
    toolTurn("write_note", { note_id: "c3", content: "Child three", note_type: "rectangle" }),
    toolTurn("link_notes", { sourceId: "root", targetId: "c1" }),
    toolTurn("link_notes", { sourceId: "root", targetId: "c2" }),
    toolTurn("link_notes", { sourceId: "root", targetId: "c3" }),
    { kind: "text", text: "The mindmap branches from the root." },
  ])


const drain = async (gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> => {
  const out: AgentEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}


const prevMode = getBoardThemeMode()
beforeEach(() => {
  resetIdb()
  setBoardThemeMode("dark")
})
afterEach(() => setBoardThemeMode(prevMode))


describe("local agent pipeline (turn → tools → arrange → persist → reload)", () => {
  it("builds, arranges, themes, and persists a mindmap across reload", async () => {
    const chatUid = "chat-1"
    const boardId = "board-1"

    // 1. Run the agent against a live store, collecting created note ids.
    const store = freshStore(boardId)
    const events = await drain(
      runAgent({ userMessage: "make a mindmap", tools: agentBuildTools, llm: mindmapScript(), ctx: { store } }),
    )
    const createdIds = events.flatMap((e) =>
      e.type === "tool_result" && e.toolName === "write_note" && e.result && typeof e.result === "object" && "id" in e.result
        ? [String((e.result as { id: unknown }).id)]
        : [],
    )
    expect(createdIds.sort()).toEqual(["c1", "c2", "c3", "root"])

    // 2. Post-turn arrange.
    await arrangeCreatedNodes(store, createdIds)

    // 3. Persist board content + the chat transcript (assistant id mints before user).
    const content = readContent(store)
    const assistant: ChatMessage = { id: "local-1-2", role: "assistant", content: { markdown: "done" }, chatUid, properties: {} }
    const user: ChatMessage = { id: "local-1-3", role: "user", content: { markdown: "make a mindmap" }, chatUid, properties: {} }
    await saveMessages(chatUid, boardId, [user, assistant])

    // 4. Reload into a fresh store (simulates a page refresh).
    const reloaded = freshStore(boardId)
    applyContentToStore(reloaded, content)
    const messages = await loadMessages(chatUid)

    // --- nodes survived + arranged bidirectionally ---
    expect(reloaded.getAllNodes()).toHaveLength(4)
    const rootX = reloaded.getNode(asNodeId("root"))!.x
    const childXs = ["c1", "c2", "c3"].map((id) => reloaded.getNode(asNodeId(id))!.x)
    expect(childXs.some((x) => x < rootX)).toBe(true)
    expect(childXs.some((x) => x > rootX)).toBe(true)

    // --- theme projected on load: dark display derived from light _storedColors ---
    const node = reloaded.getNode(asNodeId("root"))!
    const stored = (node.data as { _storedColors?: { backgroundColor?: string } })._storedColors
    expect(stored?.backgroundColor).toMatch(/^#/) // canonical light color preserved
    expect(node.style?.backgroundColor).toBe(darkModeDisplayHex(stored!.backgroundColor) ?? stored!.backgroundColor)

    // --- messages reload in conversation order (user before assistant) ---
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"])
  })
})
