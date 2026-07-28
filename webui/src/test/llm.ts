/**
 * Scripted LLM mock (A4 test harness). Returns a fixed sequence of turns so the
 * agent loop is fully deterministic and never touches the network.
 */
import type { LlmClient, LlmMessage, LlmToolDef, LlmTurn } from "@/features/agent/engine/types"


export class ScriptedLlm implements LlmClient {
  private index = 0
  /** Records what the loop sent each turn, for assertions. */
  readonly calls: { messages: number; tools: number }[] = []
  private readonly script: LlmTurn[]


  constructor(script: LlmTurn[]) {
    this.script = script
  }


  async complete(messages: LlmMessage[], tools: LlmToolDef[]): Promise<LlmTurn> {
    this.calls.push({ messages: messages.length, tools: tools.length })
    return this.script[this.index++] ?? { kind: "text", text: "" }
  }
}


/** Build a single-tool-call turn (one call per turn keeps scripts readable). */
export const toolTurn = (name: string, args: Record<string, unknown>): LlmTurn => ({
  kind: "tool_calls",
  calls: [{ id: name, name, arguments: JSON.stringify(args) }],
})
