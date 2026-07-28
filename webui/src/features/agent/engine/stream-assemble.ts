/**
 * Assemble an OpenAI streaming chunk sequence into our `LlmStreamEvent`s:
 * text deltas as they arrive, then one `final` turn. Tool-call fragments stream
 * by `index` (id/name/arguments arrive piecemeal) and are stitched back together.
 * Shared by the BYOK client; the managed client assembles from our own NDJSON.
 */
import type { ChatCompletionChunk } from "openai/resources/chat/completions"
import type { LlmStreamEvent, LlmToolCall, LlmTurn } from "./types"


export async function* assembleStreamedTurn(
  chunks: AsyncIterable<ChatCompletionChunk>,
): AsyncGenerator<LlmStreamEvent> {
  let text = ""
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  const announced = new Set<number>()

  for await (const chunk of chunks) {
    const delta = chunk.choices[0]?.delta
    if (!delta) continue
    if (delta.content) {
      text += delta.content
      yield { kind: "delta", text: delta.content }
    }
    for (const tc of delta.tool_calls ?? []) {
      const slot = calls.get(tc.index) ?? { id: "", name: "", arguments: "" }
      if (tc.id) slot.id = tc.id
      if (tc.function?.name) slot.name = tc.function.name
      if (tc.function?.arguments) slot.arguments += tc.function.arguments
      calls.set(tc.index, slot)
      // Announce the tool the instant its name is known — before the (possibly
      // long) arguments finish — so the UI shows it immediately, not after a pause.
      if (slot.name && !announced.has(tc.index)) {
        announced.add(tc.index)
        yield { kind: "tool_start", name: slot.name, id: slot.id || undefined }
      }
    }
  }

  const turn: LlmTurn =
    calls.size > 0
      ? { kind: "tool_calls", calls: [...calls.values()] as LlmToolCall[] }
      : { kind: "text", text }
  yield { kind: "final", turn }
}
