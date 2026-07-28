import { beforeEach, describe, expect, it } from "vitest"
import type { ChatMessage } from "@/features/agent/types/chat"
import { resetIdb } from "@/test/canvas"
import { listLocalChats, loadMessages, saveMessages } from "./chat-persist"


const msg = (id: string, text: string, chatUid = "c1"): ChatMessage => ({
  id,
  role: "assistant",
  content: { markdown: text },
  chatUid,
  properties: {},
})


beforeEach(() => {
  resetIdb()
})


describe("chat-persist", () => {
  it("round-trips a chat's messages", async () => {
    await saveMessages("c1", "b1", [msg("m1", "hi"), msg("m2", "there")])
    const loaded = await loadMessages("c1")
    expect(loaded.map((m) => m.content.markdown)).toEqual(["hi", "there"])
  })


  it("isolates chats and replaces a chat's transcript on save", async () => {
    await saveMessages("c1", "b1", [msg("m1", "a")])
    await saveMessages("c2", "b1", [msg("x", "other", "c2")])
    await saveMessages("c1", "b1", [msg("m1", "a"), msg("m2", "b")]) // replace c1

    expect(await loadMessages("c1")).toHaveLength(2)
    expect(await loadMessages("c2")).toHaveLength(1)
  })


  it("lists a board's chats and isolates them by board", async () => {
    await saveMessages("c1", "b1", [msg("m1", "hi")], "First chat")
    await saveMessages("c2", "b1", [msg("m1", "yo", "c2")], "Second chat")
    await saveMessages("c3", "b2", [msg("m1", "elsewhere", "c3")], "Other board")

    const b1 = await listLocalChats("b1")
    expect(b1.map((c) => c.id).sort()).toEqual(["c1", "c2"])
    expect(b1.find((c) => c.id === "c1")?.label).toBe("First chat")

    const b2 = await listLocalChats("b2")
    expect(b2.map((c) => c.id)).toEqual(["c3"])
  })


  it("loads messages in insertion order, not id/key order", async () => {
    // Reproduce the real mint order: assistant id is minted before the user id,
    // and the counter sorts lexically wrong ("...-10" < "...-9"). Key order
    // would mis-sort these; insertion order must win.
    const user = msg("local-1-9", "the question")
    const assistant = { ...msg("local-1-10", "the answer"), role: "assistant" as const }
    await saveMessages("c1", "b1", [user, assistant])

    const loaded = await loadMessages("c1")
    expect(loaded.map((m) => m.content.markdown)).toEqual(["the question", "the answer"])
  })


  it("normalizes a persisted raw_message tool step into reasoning on load", async () => {
    const withSteps: ChatMessage = {
      ...msg("m1", "answer"),
      properties: {
        reasoning: {
          type: "reasoning",
          reasoning: [
            { type: "tool_call", id: "t1", name: "raw_message", thought: "", output: '{"results":[]}', state: "completed", eventMessages: [], arguments: { input: {} } },
            { type: "tool_call", id: "t2", name: "memory_search", thought: "", output: "{}", state: "completed", eventMessages: [], arguments: { input: {} } },
          ],
        },
      },
    }
    await saveMessages("c1", "b1", [withSteps])

    const [loaded] = await loadMessages("c1")
    const steps = loaded.properties.reasoning!.reasoning
    // old raw_message tool step → reasoning (renders as text, not a boxed card)
    expect(steps.find((s) => s.id === "t1")?.type).toBe("reasoning_step")
    // a real tool stays a tool_call (boxed)
    expect(steps.find((s) => s.id === "t2")?.type).toBe("tool_call")
  })


  it("preserves a chat's label when a later save omits it", async () => {
    await saveMessages("c1", "b1", [msg("m1", "a")], "Labeled")
    await saveMessages("c1", "b1", [msg("m1", "a"), msg("m2", "b")]) // no label

    const [chat] = await listLocalChats("b1")
    expect(chat.label).toBe("Labeled")
  })
})
