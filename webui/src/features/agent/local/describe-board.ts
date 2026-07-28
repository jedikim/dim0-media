/**
 * Auto-label a fresh local board from its first conversation — the local analog
 * of the backend `DescribeBoard` agent. Runs once (only while the board is still
 * "Untitled board") and is best-effort: any failure leaves the title untouched.
 */
import type { LlmClient } from "@/features/agent/engine/types"
import { getLocalStores } from "@/features/local-stores"
import type { ChatMessage } from "@/features/agent/types/chat"
import describeBoardPrompt from "@/features/agent/prompts/describe-board.md?raw"


const UNTITLED = "Untitled board"


/** Condense the opening turns into the labeling input. */
export const buildLabelInput = (messages: ChatMessage[]): string =>
  messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, 4)
    .map((m) => `${m.role}: ${m.content.markdown?.trim() ?? ""}`)
    .filter((line) => line.length > "assistant: ".length)
    .join("\n\n")


/** Strip quotes/JSON noise, take the first line, cap the length. */
export const cleanTitle = (raw: string): string =>
  raw
    .trim()
    .replace(/^\s*\{?\s*"?title"?\s*:?\s*/i, "") // tolerate a stray JSON-ish wrapper
    .replace(/^["'`]+|["'`}]+$/g, "")
    .split("\n")[0]
    .slice(0, 60)
    .trim()


/** Ask the model for a board title from the transcript, or null if it can't. */
export const describeBoardTitle = async (messages: ChatMessage[], llm: LlmClient): Promise<string | null> => {
  const input = buildLabelInput(messages)
  if (!input) return null
  const turn = await llm.complete(
    [
      { role: "system", content: describeBoardPrompt },
      { role: "user", content: input },
    ],
    [],
  )
  if (turn.kind !== "text") return null
  const title = cleanTitle(turn.text)
  return title || null
}


/**
 * Label `boardId` from its transcript IF it's still untitled. No-op when the
 * board already has a real name, there's no transcript, or no client. `llm` is
 * injectable for tests.
 */
export const maybeAutoLabelBoard = async (
  boardId: string,
  messages: ChatMessage[],
  llm: LlmClient | null,
): Promise<void> => {
  if (!llm) return
  try {
    const { boards } = await getLocalStores()
    const meta = await boards.getBoard(boardId)
    if (!meta || (meta.title && meta.title !== UNTITLED)) return
    const title = await describeBoardTitle(messages, llm)
    if (title) await boards.renameBoard(boardId, title)
  } catch {
    // best-effort labeling — never disrupt the turn
  }
}
