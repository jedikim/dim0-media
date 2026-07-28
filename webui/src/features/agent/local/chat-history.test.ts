import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/features/agent/types/chat"
import type { ReasoningStep } from "@/features/agent/types/stream"
import { toLlmHistory } from "./chat-history"


const user = (text: string): ChatMessage => ({
  id: `u-${text}`,
  role: "user",
  content: { markdown: text },
  chatUid: "c1",
  properties: {},
})


const assistant = (text: string, reasoning: ReasoningStep[] = []): ChatMessage => ({
  id: `a-${text}`,
  role: "assistant",
  content: { markdown: text },
  chatUid: "c1",
  properties: { reasoning: { type: "reasoning", reasoning } },
})


const createNoteStep = (noteId: string, title: string): ReasoningStep => ({
  type: "tool_call",
  id: `t-${noteId}`,
  name: "create_note",
  thought: "",
  output: { type: "create_note", noteId, graphUid: "c1", label: title, noteType: "note" },
  state: "completed",
  eventMessages: [],
  arguments: { input: { title } },
})


describe("toLlmHistory", () => {
  it("keeps role + answer text for plain turns", () => {
    const history = toLlmHistory([user("hi"), assistant("hello")])
    expect(history).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ])
  })


  it("embeds tool traces (call + input + output) into assistant context", () => {
    const [, asst] = toLlmHistory([
      user("make a note about cats"),
      assistant("Done — created it.", [createNoteStep("n1", "Cats")]),
    ])
    // The agent must see WHAT it did, incl. the note id it created.
    expect(asst.content).toContain("<ToolCall name=\"create_note\">")
    expect(asst.content).toContain("title=\"Cats\"")
    expect(asst.content).toContain("n1")
    expect(asst.content).toContain("Done — created it.")
  })


  it("retains a tool-only turn (no answer text) so the trace isn't lost", () => {
    const history = toLlmHistory([user("build"), assistant("", [createNoteStep("n9", "X")])])
    expect(history).toHaveLength(2)
    expect(history[1].content).toContain("create_note")
  })


  it("caps to the most recent N messages", () => {
    const many: ChatMessage[] = Array.from({ length: 40 }, (_, i) => user(`m${i}`))
    const history = toLlmHistory(many, 16)
    expect(history).toHaveLength(16)
    expect(history[0].content).toBe("m24")
    expect(history.at(-1)?.content).toBe("m39")
  })
})
