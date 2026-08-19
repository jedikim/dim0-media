import { describe, expect, it } from "vitest"
import { z } from "zod"
import { runAgent } from "./agent-loop"
import type { AgentEvent, LlmClient, LlmStreamEvent, Tool, ToolContext } from "./types"


/** A scripted streaming client: one event-list per turn (last repeats). */
const streamingClient = (turns: LlmStreamEvent[][]): LlmClient => {
  let i = 0
  return {
    complete: async () => ({ kind: "text", text: "" }),
    async *completeStream() {
      const events = turns[Math.min(i, turns.length - 1)]
      i += 1
      for (const ev of events) yield ev
    },
  }
}

const run = async (llm: LlmClient, tools: Tool[] = []): Promise<AgentEvent[]> => {
  const out: AgentEvent[] = []
  for await (const ev of runAgent({ userMessage: "hi", tools, llm, ctx: {} as unknown as ToolContext })) {
    out.push(ev)
  }
  return out
}

const texts = (evs: AgentEvent[]): string[] =>
  evs.flatMap((e) => (e.type === "assistant_text" ? [e.text] : []))


describe("runAgent (streaming)", () => {
  it("prefers completeStream and emits cumulative assistant_text per delta", async () => {
    const llm = streamingClient([[
      { kind: "delta", text: "Hel" },
      { kind: "delta", text: "lo" },
      { kind: "final", turn: { kind: "text", text: "Hello" } },
    ]])
    const evs = await run(llm)
    const t = texts(evs)
    expect(t[0]).toBe("Hel") // partial shown first (token-by-token)
    expect(t.at(-1)).toBe("Hello") // full text at the end
    expect(t.length).toBeGreaterThanOrEqual(2) // streamed, not one-shot
    expect(evs.at(-1)).toEqual({ type: "done" })
  })

  it("runs a tool from a streamed tool_calls turn, then finishes on the next turn", async () => {
    const tool: Tool = {
      name: "t",
      description: "d",
      parameters: z.object({}),
      run: async () => ({ ok: true }),
    }
    const llm = streamingClient([
      [{ kind: "final", turn: { kind: "tool_calls", calls: [{ id: "c1", name: "t", arguments: "{}" }] } }],
      [{ kind: "delta", text: "finished" }, { kind: "final", turn: { kind: "text", text: "finished" } }],
    ])
    const evs = await run(llm, [tool])
    expect(evs.some((e) => e.type === "tool_start" && e.toolName === "t")).toBe(true)
    expect(evs.some((e) => e.type === "tool_result" && e.toolName === "t")).toBe(true)
    expect(texts(evs).at(-1)).toBe("finished")
    expect(evs.at(-1)).toEqual({ type: "done" })
  })

  it("accumulates reasoning deltas into cumulative reasoning events, separate from the answer", async () => {
    const llm = streamingClient([[
      { kind: "reasoning", text: "Let me " },
      { kind: "reasoning", text: "think." },
      { kind: "delta", text: "Answer" },
      { kind: "final", turn: { kind: "text", text: "Answer" } },
    ]])
    const evs = await run(llm)
    const reasoning = evs.flatMap((e) => (e.type === "reasoning" ? [e.text] : []))
    expect(reasoning).toEqual(["Let me ", "Let me think."]) // cumulative, not per-fragment
    expect(texts(evs).at(-1)).toBe("Answer") // reasoning never leaks into the answer body
  })
})
