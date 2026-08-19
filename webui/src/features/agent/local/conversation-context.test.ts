import { beforeEach, describe, expect, it } from "vitest"
import { resetIdb } from "@/test/canvas"
import { ScriptedLlm } from "@/test/llm"
import { getLocalStores } from "@/features/local-stores"
import type { ChatMessage } from "@/features/agent/types/chat"
import {
  CONV_CTX_TURNS,
  estimateTokens,
  maybeRefreshConversationContext,
  shouldRefreshConversation,
  summarizeConversation,
  turnsSince,
} from "./conversation-context"


const msg = (role: "user" | "assistant", text: string): ChatMessage => ({
  id: `${role}-${Math.random()}`,
  role,
  content: { markdown: text },
  chatUid: "c1",
  properties: {},
})


beforeEach(() => resetIdb())


describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("12345678")).toBe(2)
    expect(estimateTokens("")).toBe(0)
  })
})


describe("turnsSince", () => {
  it("keeps short but non-empty user turns (ok/yes/no)", () => {
    const out = turnsSince([msg("user", "ok"), msg("assistant", "sure")], 0)
    expect(out).toBe("user: ok\n\nassistant: sure")
  })

  it("drops empty-content messages", () => {
    expect(turnsSince([msg("user", ""), msg("assistant", "hi")], 0)).toBe("assistant: hi")
  })

  it("folds every turn since the index (no middle-turn gap)", () => {
    const all = Array.from({ length: 6 }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", `t${i}`))
    // Prior refresh covered the first 2; this fold must include turns 2..5, not just the last few.
    expect(turnsSince(all, 2)).toBe("user: t2\n\nassistant: t3\n\nuser: t4\n\nassistant: t5")
  })

  it("is empty when the index is past the end (post-deletion safety)", () => {
    expect(turnsSince([msg("user", "hi")], 5)).toBe("")
  })
})


describe("shouldRefreshConversation", () => {
  it("fires when the turn count grows past the floor", () => {
    expect(shouldRefreshConversation({ contextTurnAt: 0 }, CONV_CTX_TURNS, 0)).toBe(true)
  })

  it("fires on token growth even under the turn floor", () => {
    expect(shouldRefreshConversation({ contextTurnAt: 0, contextTokenAt: 0 }, 1, 5000)).toBe(true)
  })

  it("does not fire when both are under their thresholds", () => {
    expect(shouldRefreshConversation({ contextTurnAt: 1, contextTokenAt: 100 }, 2, 200)).toBe(false)
  })
})


describe("maybeRefreshConversationContext", () => {
  const seedChat = async (chatUid: string, messages: ChatMessage[]) => {
    const { chats } = await getLocalStores()
    await chats.saveTranscript(chatUid, "board-1", messages)
  }

  const contextOf = async (chatUid: string): Promise<string | undefined> => {
    const { chats } = await getLocalStores()
    return (await chats.getChat(chatUid))?.context
  }

  const manyTurns = (): ChatMessage[] =>
    Array.from({ length: CONV_CTX_TURNS + 1 }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", `turn ${i}`))


  it("writes a rolling summary once the thread has grown enough", async () => {
    await seedChat("c1", manyTurns())
    const llm = new ScriptedLlm([{ kind: "text", text: "User is planning a trip; itinerary drafted." }])
    await maybeRefreshConversationContext("c1", manyTurns(), llm)
    expect(await contextOf("c1")).toBe("User is planning a trip; itinerary drafted.")
  })


  it("does not summarize a short thread under the gate", async () => {
    await seedChat("c1", [msg("user", "hi"), msg("assistant", "hello")])
    const llm = new ScriptedLlm([{ kind: "text", text: "should not be written" }])
    await maybeRefreshConversationContext("c1", [msg("user", "hi"), msg("assistant", "hello")], llm)
    expect(await contextOf("c1")).toBeUndefined()
  })


  it("no-ops with a null client (keeps the last-good context)", async () => {
    await seedChat("c1", manyTurns())
    await maybeRefreshConversationContext("c1", manyTurns(), null)
    expect(await contextOf("c1")).toBeUndefined()
  })
})


describe("summarizeConversation (forced, for compaction)", () => {
  const seedChat = async (chatUid: string, messages: ChatMessage[]) => {
    const { chats } = await getLocalStores()
    await chats.saveTranscript(chatUid, "board-1", messages)
  }


  it("summarizes even a SHORT thread that the gate would skip, and persists it", async () => {
    await seedChat("c1", [msg("user", "hi"), msg("assistant", "hello")])
    const llm = new ScriptedLlm([{ kind: "text", text: "User greeted the assistant." }])
    const summary = await summarizeConversation("c1", [msg("user", "hi"), msg("assistant", "hello")], llm)
    expect(summary).toBe("User greeted the assistant.")
    const { chats } = await getLocalStores()
    expect((await chats.getChat("c1"))?.context).toBe("User greeted the assistant.")
  })


  it("returns null with a null client (best-effort, no throw)", async () => {
    await seedChat("c1", [msg("user", "hi")])
    expect(await summarizeConversation("c1", [msg("user", "hi")], null)).toBeNull()
  })


  it("returns null when a never-summarized thread yields no summary (compaction then won't trim)", async () => {
    await seedChat("c1", [msg("user", "hi"), msg("assistant", "yo")])
    const llm = new ScriptedLlm([{ kind: "text", text: "   " }]) // whitespace → empty summary
    expect(await summarizeConversation("c1", [msg("user", "hi"), msg("assistant", "yo")], llm)).toBeNull()
  })


  it("returns the existing summary (non-null) when there's nothing new to fold", async () => {
    await seedChat("c1", [msg("user", "hi"), msg("assistant", "yo")])
    const { chats } = await getLocalStores()
    await chats.setChatContext("c1", "existing summary", { turnAt: 2, tokenAt: 10 })
    // contextTurnAt (2) == messages.length (2) → no new turns → returns existing, no LLM.
    const llm = new ScriptedLlm([{ kind: "text", text: "SHOULD NOT RUN" }])
    expect(await summarizeConversation("c1", [msg("user", "hi"), msg("assistant", "yo")], llm)).toBe("existing summary")
  })
})
