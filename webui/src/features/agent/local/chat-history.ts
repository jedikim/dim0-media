/**
 * Compact a stored transcript into the agent's prior-turn context. Mirrors the
 * backend's `Message.to_chat_message` / `_compact_reasoning`: each assistant
 * turn carries its TOOL TRACES (calls + inputs + outputs) inline, not just the
 * answer text — the agent needs to know what it did (e.g. the note ids it
 * created) to continue coherently across turns.
 */
import type { ChatMessage } from "@/features/agent/types/chat"
import type { LlmMessage } from "@/features/agent/engine/types"
import type { ReasoningStep } from "@/features/agent/types/stream"
import { isToolCallStep } from "@/features/agent/types/stream"
import type { ToolOutput } from "@/features/agent/types/tool-outputs"
import { wrapWithMessageContext } from "./message-context"


// Recent turns fed back as context. Mirrors the backend AssistantSession
// (MAX_RETRIEVAL_MESSAGES) and per-field cap (MAX_COMPACT_TEXT_LENGTH).
export const MAX_HISTORY_MESSAGES = 16
const MAX_COMPACT_TEXT_LENGTH = 10_000
// How many of the most-recent assistant turns keep FULL tool output; older turns
// age down to MAX_AGED_OUTPUT_CHARS (bulk dropped, head/ids preserved) so stale
// output doesn't dominate the re-sent history.
export const RECENT_FULL_TURNS = 4
export const MAX_AGED_OUTPUT_CHARS = 500


const truncate = (s: string, cap = MAX_COMPACT_TEXT_LENGTH): string =>
  s.length > cap ? s.slice(0, cap) + "..." : s


/** Render a single tool-call argument value as a short string. */
const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return "[unserializable]"
  }
}


/** `key="val", key2="val2"` summary of a tool call's input args. */
const compactInput = (input: unknown): string => {
  if (!input || typeof input !== "object") return ""
  const args = Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => `${k}="${formatValue(v)}"`)
    .join(", ")
  return truncate(args)
}


/** Short summary of a tool call's output. `outputCap` shrinks for aged turns so
 *  stale bulk drops while the head (ids, first fields) survives. */
const compactOutput = (output: ToolOutput, outputCap: number): string => {
  if (typeof output === "string") return truncate(output.trim().replace(/\n/g, " "), outputCap)
  try {
    return truncate(JSON.stringify(output), outputCap)
  } catch {
    return ""
  }
}


/** One reasoning step as the backend's compact XML-ish block. */
const compactStep = (step: ReasoningStep, outputCap: number): string => {
  if (isToolCallStep(step)) {
    const input = compactInput(step.arguments?.input)
    const output = compactOutput(step.output, outputCap)
    const parts = [`<ToolCall name="${step.name}">`]
    if (input) parts.push(`<Input>${input}</Input>`)
    if (output) parts.push(`<Output>${output}</Output>`)
    parts.push("</ToolCall>")
    return parts.join("\n")
  }
  const parts: string[] = []
  if (step.reasoning?.trim()) parts.push(`<Thought>${step.reasoning.trim()}</Thought>`)
  if (step.message?.trim()) parts.push(`<Message>${step.message.trim()}</Message>`)
  return parts.length ? ["<ReasoningStep>", ...parts, "</ReasoningStep>"].join("\n") : ""
}


/** Wrap a turn's reasoning steps in a `<Reasoning>` block (empty if none). */
const compactReasoning = (steps: ReasoningStep[], outputCap: number): string => {
  const body = steps.map((s) => compactStep(s, outputCap)).filter(Boolean).join("\n\n")
  return body ? `<Reasoning>\n\n${body}\n\n</Reasoning>` : ""
}


/**
 * A message's LLM content: assistant turns prepend their reasoning/tool traces.
 * `outputCap` bounds tool-output length — smaller for older (aged) turns.
 */
const compactMessageContent = (message: ChatMessage, outputCap: number): string => {
  const markdown = message.content.markdown?.trim() ?? ""
  if (message.role !== "assistant") {
    // Mirror the backend's `to_chat_message`: a past user turn re-includes the
    // selected-note context it was sent with, so cross-turn references ("expand
    // it") stay resolvable. wrapWithMessageContext emits the same envelope the
    // live turn uses, and returns the bare prompt when there's no context.
    return wrapWithMessageContext(markdown, message.properties?.context?.text)
  }
  const reasoning = compactReasoning(message.properties?.reasoning?.reasoning ?? [], outputCap)
  return reasoning ? `${reasoning}\n\n${markdown}`.trim() : markdown
}


/**
 * Convert the stored transcript into the agent's prior-turn context. Tool output
 * ages by recency: the last `RECENT_FULL_TURNS` ASSISTANT turns keep full output;
 * older ones shrink to `MAX_AGED_OUTPUT_CHARS`, so stale bulk doesn't dominate.
 */
export const toLlmHistory = (messages: ChatMessage[], max = MAX_HISTORY_MESSAGES): LlmMessage[] => {
  // Window = the last `max` messages that render to non-empty content. Emptiness
  // is cap-independent (aging keeps the <ToolCall> wrapper + markdown), so a
  // full-cap render is a sound emptiness probe — filter BEFORE slicing so empty
  // turns don't consume window slots (matches the pre-aging behavior).
  const window = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => compactMessageContent(m, MAX_COMPACT_TEXT_LENGTH) !== "")
    .slice(-max)
  // Full-output cutoff = the index of the RECENT_FULL_TURNS-th assistant turn from
  // the end (only assistant turns carry tool output); turns at/after it stay full.
  let assistantSeen = 0
  let fullFrom = 0
  for (let i = window.length - 1; i >= 0; i -= 1) {
    fullFrom = i
    if (window[i].role === "assistant" && ++assistantSeen === RECENT_FULL_TURNS) break
  }
  return window.map((m, i) => ({
    role: m.role as "user" | "assistant",
    content: compactMessageContent(m, i >= fullFrom ? MAX_COMPACT_TEXT_LENGTH : MAX_AGED_OUTPUT_CHARS),
  }))
}
