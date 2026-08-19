import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/features/agent/types/chat"
import type { ReasoningStep } from "@/features/agent/types/stream"
import type { LlmMessage } from "@/features/agent/engine/types"
import {
  COMPACT_PCT,
  COMPACT_TAIL_MESSAGES,
  COMPACT_TOKEN_BUDGET,
  MAX_AGED_OUTPUT_CHARS,
  RECENT_FULL_TURNS,
  compactHistory,
  estimatePromptTokens,
  isOverCompactionBudget,
  toLlmHistory,
} from "./chat-history"


const user = (text: string): ChatMessage => ({
  id: `u-${text}`,
  role: "user",
  content: { markdown: text },
  chatUid: "c1",
  properties: {},
})


const userWithContext = (text: string, context: string): ChatMessage => ({
  id: `u-${text}`,
  role: "user",
  content: { markdown: text },
  chatUid: "c1",
  properties: { context: { type: "text", text: context } },
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


// A tool step whose output is a big string (e.g. a fetched page), to exercise aging.
const bigOutputStep = (id: string, size: number): ReasoningStep => ({
  type: "tool_call",
  id: `t-${id}`,
  name: "fetch",
  thought: "",
  output: "x".repeat(size),
  state: "completed",
  eventMessages: [],
  arguments: { input: { url: "https://a.com" } },
})


const outputLen = (content: string): number => content.match(/<Output>([\s\S]*?)<\/Output>/)?.[1].length ?? 0


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


  it("re-wraps a past user turn's selected-note context (mirrors the backend)", () => {
    const ctx = "<SelectedNote>\nNoteId: n1\nTitle: Cats\n</SelectedNote>"
    const [first] = toLlmHistory([
      userWithContext("expand it", ctx),
      assistant("sure"),
    ])
    // The agent must still see WHAT "it" referred to on a reloaded conversation.
    expect(first.content).toBe(`<MessageContext>\n\n${ctx}\n\n</MessageContext>\n\nexpand it`)
  })


  it("leaves a user turn without context as bare text", () => {
    const [first] = toLlmHistory([user("hi"), assistant("hello")])
    expect(first.content).toBe("hi") // no empty <MessageContext> envelope
  })


  it("caps to the most recent N messages", () => {
    const many: ChatMessage[] = Array.from({ length: 40 }, (_, i) => user(`m${i}`))
    const history = toLlmHistory(many, 16)
    expect(history).toHaveLength(16)
    expect(history[0].content).toBe("m24")
    expect(history.at(-1)?.content).toBe("m39")
  })


  it("ages old tool output to a small cap while the most-recent turn keeps it full", () => {
    // A run of tool-only assistant turns; only the last RECENT_FULL_TURNS keep full output.
    const turns: ChatMessage[] = []
    for (let i = 0; i < RECENT_FULL_TURNS + 2; i += 1) turns.push(user(`q${i}`), assistant("", [bigOutputStep(`f${i}`, 5000)]))
    const history = toLlmHistory(turns, turns.length)
    const oldest = history[1] // first assistant turn — aged out
    const newest = history.at(-1)! // most recent assistant turn — full
    expect(outputLen(oldest.content)).toBeLessThanOrEqual(MAX_AGED_OUTPUT_CHARS + 3) // "..." marker
    expect(outputLen(newest.content)).toBe(5000) // under the 10k full cap, untouched
  })


  it("keeps full output for exactly the last RECENT_FULL_TURNS ASSISTANT turns (not messages)", () => {
    const turns: ChatMessage[] = []
    const total = RECENT_FULL_TURNS + 3
    for (let i = 0; i < total; i += 1) turns.push(user(`q${i}`), assistant("", [bigOutputStep(`f${i}`, 5000)]))
    const history = toLlmHistory(turns, turns.length)
    // Assistant entries sit at the odd indices (each preceded by its user turn).
    const fullCount = history.filter((_, i) => i % 2 === 1).map((h) => outputLen(h.content)).filter((n) => n === 5000).length
    expect(fullCount).toBe(RECENT_FULL_TURNS) // 4 assistant turns, not 2
  })


  it("does not let an empty-rendering message consume a window slot", () => {
    // An assistant turn with no text and no reasoning renders to "" — it must not
    // eat a slot inside the last-`max` window (regression vs filter-before-slice).
    const msgs = [...Array.from({ length: 16 }, (_, i) => user(`m${i}`)), assistant("", [])]
    const history = toLlmHistory(msgs, 16)
    expect(history).toHaveLength(16)
    expect(history.map((h) => h.content)).toEqual(Array.from({ length: 16 }, (_, i) => `m${i}`))
  })


  it("keeps a created note id visible even after a turn's output ages out", () => {
    const turns: ChatMessage[] = [user("build"), assistant("", [createNoteStep("n42", "Cats")])]
    // Pad with recent turns so the note turn is aged out of the full window.
    for (let i = 0; i < RECENT_FULL_TURNS; i += 1) turns.push(user(`later${i}`), assistant(`ok${i}`))
    const [, noteTurn] = toLlmHistory(turns, turns.length)
    expect(noteTurn.content).toContain("n42") // id survives aging (it's at the head)
  })
})


describe("compaction", () => {
  const hist = (...contents: string[]): LlmMessage[] => contents.map((c, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: c }))


  it("estimatePromptTokens sums system + history + user (~4 chars/token)", () => {
    const tokens = estimatePromptTokens("a".repeat(40), hist("b".repeat(40), "c".repeat(40)), "d".repeat(40))
    expect(tokens).toBe(10 + 10 + 10 + 10) // four 40-char strings ÷ 4
  })


  it("isOverCompactionBudget trips only past COMPACT_PCT of the budget", () => {
    const threshold = COMPACT_PCT * COMPACT_TOKEN_BUDGET // tokens
    const under = "x".repeat((threshold - 100) * 4)
    const over = "x".repeat((threshold + 100) * 4)
    expect(isOverCompactionBudget(under, [], "")).toBe(false)
    expect(isOverCompactionBudget(over, [], "")).toBe(true)
  })


  it("compactHistory trims to the verbatim recent tail, byte-for-byte", () => {
    const full = hist(...Array.from({ length: COMPACT_TAIL_MESSAGES + 4 }, (_, i) => `m${i}`))
    const trimmed = compactHistory(full)
    expect(trimmed).toHaveLength(COMPACT_TAIL_MESSAGES)
    expect(trimmed).toEqual(full.slice(-COMPACT_TAIL_MESSAGES)) // exact same messages, unmodified
  })


  it("compactHistory leaves a short history untouched (never trims below the tail)", () => {
    const short = hist("a", "b")
    expect(compactHistory(short)).toEqual(short)
  })


  it("compactHistory drops a leading assistant so the tail starts user-first", () => {
    // A window whose last COMPACT_TAIL_MESSAGES begin with an assistant turn.
    const full: LlmMessage[] = [
      ...Array.from({ length: 4 }, (_, i): LlmMessage => ({ role: "user", content: `x${i}` })),
      { role: "assistant", content: "a0" }, // this becomes the first of the tail
      ...Array.from({ length: COMPACT_TAIL_MESSAGES }, (_, i): LlmMessage => ({ role: i % 2 === 0 ? "user" : "assistant", content: `t${i}` })),
    ]
    const trimmed = compactHistory(full)
    expect(trimmed[0].role).toBe("user") // never assistant-first
    expect(trimmed.length).toBeLessThanOrEqual(COMPACT_TAIL_MESSAGES)
  })
})
