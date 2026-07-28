import { describe, expect, it } from "vitest"
import type { ChatCompletion, ChatCompletionChunk } from "openai/resources/chat/completions"
import { ByokLlmClient, type ChatCompleter } from "./byok-client"
import type { LlmStreamEvent } from "./types"


async function* chunksOf(...cs: unknown[]): AsyncGenerator<ChatCompletionChunk> {
  for (const c of cs) yield c as ChatCompletionChunk
}
const textChunk = (content: string) => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })

const drain = async (it: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> => {
  const out: LlmStreamEvent[] = []
  for await (const ev of it) out.push(ev)
  return out
}


describe("ByokLlmClient.completeStream", () => {
  it("streams deltas + final via the completer's createStream", async () => {
    const completer: ChatCompleter = {
      create: async () => {
        throw new Error("create must not be called when streaming")
      },
      createStream: async () => chunksOf(textChunk("Hi"), textChunk("!")),
    }
    const events = await drain(new ByokLlmClient(completer, "m").completeStream([{ role: "user", content: "x" }], []))
    expect(events).toEqual([
      { kind: "delta", text: "Hi" },
      { kind: "delta", text: "!" },
      { kind: "final", turn: { kind: "text", text: "Hi!" } },
    ])
  })

  it("degrades to a single final turn when the completer has no createStream", async () => {
    const completer: ChatCompleter = {
      create: async () =>
        ({
          choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content: "done", refusal: null } }],
        }) as unknown as ChatCompletion,
    }
    const events = await drain(new ByokLlmClient(completer, "m").completeStream([{ role: "user", content: "x" }], []))
    expect(events).toEqual([{ kind: "final", turn: { kind: "text", text: "done" } }])
  })
})
