import { describe, expect, it, vi } from "vitest"
import type { ChatCompletion } from "openai/resources/chat/completions"
import type { LlmMessage, LlmStreamEvent } from "./types"
import { managedLlmClient, type LlmStreamPost, type LlmTurnPost, type ManagedStreamLine } from "./managed-client"



const completion = (message: ChatCompletion["choices"][number]["message"]): { choices: ChatCompletion["choices"] } => ({
  choices: [{ index: 0, finish_reason: "stop", logprobs: null, message }],
})


const messages: LlmMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "make a note" },
]


describe("managedLlmClient", () => {
  it("posts the model + OpenAI-mapped messages to the proxy", async () => {
    const post = vi.fn<LlmTurnPost>(async () =>
      completion({ role: "assistant", content: "ok", refusal: null }),
    )
    const llm = managedLlmClient("auto", { post })
    await llm.complete(messages, [])

    const body = post.mock.calls[0][0]
    expect(body.model).toBe("auto")
    // messages were mapped to OpenAI shape (system + user roles preserved)
    expect(Array.isArray(body.messages)).toBe(true)
    expect((body.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"])
  })

  it("maps a text response to an LlmTurn text", async () => {
    const post = vi.fn<LlmTurnPost>(async () =>
      completion({ role: "assistant", content: "the answer", refusal: null }),
    )
    const turn = await managedLlmClient("auto", { post }).complete(messages, [])
    expect(turn).toEqual({ kind: "text", text: "the answer" })
  })

  it("maps a tool-call response to an LlmTurn tool_calls", async () => {
    const post = vi.fn<LlmTurnPost>(async () =>
      completion({
        role: "assistant",
        content: null,
        refusal: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "create_note", arguments: '{"t":1}' } },
        ],
      }),
    )
    const turn = await managedLlmClient("claude-opus-4.8", { post }).complete(messages, [
      { name: "create_note", description: "d", parameters: { type: "object" } },
    ])
    expect(turn.kind).toBe("tool_calls")
    if (turn.kind === "tool_calls") {
      expect(turn.calls).toEqual([{ id: "c1", name: "create_note", arguments: '{"t":1}' }])
    }
  })

  it("forwards tool defs (OpenAI-shaped) to the proxy", async () => {
    const post = vi.fn<LlmTurnPost>(async () =>
      completion({ role: "assistant", content: "x", refusal: null }),
    )
    await managedLlmClient("auto", { post }).complete(messages, [
      { name: "f", description: "d", parameters: { type: "object" } },
    ])
    const body = post.mock.calls[0][0]
    expect((body.tools as { function: { name: string } }[])[0].function.name).toBe("f")
  })
})


const streamOf = (...lines: ManagedStreamLine[]): LlmStreamPost =>
  async function* () {
    for (const line of lines) yield line
  }


describe("managedLlmClient.completeStream", () => {
  const drain = async (it: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> => {
    const out: LlmStreamEvent[] = []
    for await (const ev of it) out.push(ev)
    return out
  }

  it("maps NDJSON delta lines to delta events and the final message to a turn", async () => {
    const streamPost = streamOf(
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "final", message: { role: "assistant", content: "Hello", refusal: null } },
    )
    const llm = managedLlmClient("auto", { streamPost })
    const events = await drain(llm.completeStream!(messages, []))
    expect(events).toEqual([
      { kind: "delta", text: "Hel" },
      { kind: "delta", text: "lo" },
      { kind: "final", turn: { kind: "text", text: "Hello" } },
    ])
  })

  it("maps NDJSON reasoning lines to reasoning events, kept separate from the answer", async () => {
    const streamPost = streamOf(
      { type: "reasoning", text: "Let me " },
      { type: "reasoning", text: "think." },
      { type: "delta", text: "Answer" },
      { type: "final", message: { role: "assistant", content: "Answer", refusal: null } },
    )
    const events = await drain(managedLlmClient("auto", { streamPost }).completeStream!(messages, []))
    expect(events).toEqual([
      { kind: "reasoning", text: "Let me " },
      { kind: "reasoning", text: "think." },
      { kind: "delta", text: "Answer" },
      { kind: "final", turn: { kind: "text", text: "Answer" } },
    ])
  })

  it("maps an early tool_start line to a tool_start event", async () => {
    const streamPost = streamOf(
      { type: "tool_start", name: "write_note", id: "c1" },
      { type: "final", message: { role: "assistant", content: null, refusal: null, tool_calls: [{ id: "c1", type: "function", function: { name: "write_note", arguments: "{}" } }] } },
    )
    const events = await drain(managedLlmClient("auto", { streamPost }).completeStream!(messages, []))
    expect(events[0]).toEqual({ kind: "tool_start", name: "write_note", id: "c1" })
  })

  it("maps a final tool-call message to a tool_calls turn", async () => {
    const streamPost = streamOf({
      type: "final",
      message: {
        role: "assistant",
        content: null,
        refusal: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "create_note", arguments: "{}" } }],
      },
    })
    const events = await drain(managedLlmClient("auto", { streamPost }).completeStream!(messages, []))
    expect(events).toEqual([
      { kind: "final", turn: { kind: "tool_calls", calls: [{ id: "c1", name: "create_note", arguments: "{}" }] } },
    ])
  })
})
