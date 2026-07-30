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


const truncate = (s: string): string =>
  s.length > MAX_COMPACT_TEXT_LENGTH ? s.slice(0, MAX_COMPACT_TEXT_LENGTH) + "..." : s


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


/** Short summary of a tool call's output (string truncated, object as JSON). */
const compactOutput = (output: ToolOutput): string => {
  if (typeof output === "string") return truncate(output.trim().replace(/\n/g, " "))
  try {
    return truncate(JSON.stringify(output))
  } catch {
    return ""
  }
}


/** One reasoning step as the backend's compact XML-ish block. */
const compactStep = (step: ReasoningStep): string => {
  if (isToolCallStep(step)) {
    const input = compactInput(step.arguments?.input)
    const output = compactOutput(step.output)
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
const compactReasoning = (steps: ReasoningStep[]): string => {
  const body = steps.map(compactStep).filter(Boolean).join("\n\n")
  return body ? `<Reasoning>\n\n${body}\n\n</Reasoning>` : ""
}


/** A message's LLM content: assistant turns prepend their reasoning/tool traces. */
const compactMessageContent = (message: ChatMessage): string => {
  const markdown = message.content.markdown?.trim() ?? ""
  if (message.role !== "assistant") {
    // Mirror the backend's `to_chat_message`: a past user turn re-includes the
    // selected-note context it was sent with, so cross-turn references ("expand
    // it") stay resolvable. wrapWithMessageContext emits the same envelope the
    // live turn uses, and returns the bare prompt when there's no context.
    return wrapWithMessageContext(markdown, message.properties?.context?.text)
  }
  const reasoning = compactReasoning(message.properties?.reasoning?.reasoning ?? [])
  return reasoning ? `${reasoning}\n\n${markdown}`.trim() : markdown
}


/** Convert the stored transcript into the agent's prior-turn context. */
export const toLlmHistory = (messages: ChatMessage[], max = MAX_HISTORY_MESSAGES): LlmMessage[] =>
  messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: compactMessageContent(m) }))
    .filter((m) => m.content !== "")
    .slice(-max)
