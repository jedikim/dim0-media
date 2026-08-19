/**
 * Auto-label a fresh local board from its first conversation — the local analog
 * of the backend `DescribeBoard` agent. Runs once (only while the board is still
 * "Untitled board") and is best-effort: any failure leaves the title untouched.
 */
import type { CanvasStore } from "@canvas-harness/core"
import type { LlmClient } from "@/features/agent/engine/types"
import { getLocalStores } from "@/features/local-stores"
import type { ChatMessage } from "@/features/agent/types/chat"
import describeBoardPrompt from "@/features/agent/prompts/describe-board.md?raw"
import { boardDriftSince, shouldDerivePurpose } from "./board-drift"
import { buildBoardSnapshot, readRecentOps, renderBoardSnapshot } from "./board-snapshot"


const UNTITLED = "Untitled board"


const BOARD_PURPOSE_PROMPT =
  "You describe what a visual board is fundamentally about, from a snapshot of its current contents. " +
  "Return 1-2 sentences naming the board's subject and how it's organized — a standing purpose the " +
  "assistant can rely on across sessions. Return only the description, no preamble."


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


/**
 * Re-derive the board's PURPOSE from its current state IF it has drifted enough
 * since the last derive (deterministic gate, no LLM until the gate passes). On
 * success, persists the purpose and resets the drift baseline to the post-turn
 * oplog seq — so a build turn's own writes don't immediately re-trigger. Runs
 * fire-and-forget at turn end; any failure leaves the last-good purpose. `llm` is
 * injectable for tests.
 */
export const maybeDeriveBoardPurpose = async (
  boardId: string,
  store: CanvasStore,
  rootId: string | null,
  llm: LlmClient | null,
): Promise<void> => {
  if (!llm) return
  try {
    const { boards, engine } = await getLocalStores()
    const meta = await boards.getBoard(boardId)
    if (!meta) return
    const since = meta.contextDeriveSeq ?? 0
    const recent = await readRecentOps(engine, boardId, since)
    const now = Date.now()
    if (!shouldDerivePurpose(meta, boardDriftSince(recent), now)) return

    const state = renderBoardSnapshot(buildBoardSnapshot(store, rootId, []), { title: meta.title })
    const turn = await llm.complete(
      [
        { role: "system", content: BOARD_PURPOSE_PROMPT },
        { role: "user", content: state },
      ],
      [],
    )
    if (turn.kind !== "text") return
    const purpose = turn.text.trim()
    if (!purpose) return
    // Baseline = the post-turn max seq (this turn's ops included), so the next
    // drift is measured from AFTER this turn, not against its own writes.
    const maxSeq = recent.reduce((m, r) => Math.max(m, r.seq), since)
    await boards.setBoardContext(boardId, purpose, { derivedAt: now, deriveSeq: maxSeq })
  } catch {
    // best-effort — never disrupt the turn
  }
}
