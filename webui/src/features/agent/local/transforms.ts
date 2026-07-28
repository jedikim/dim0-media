/**
 * Local answer/selection transforms — the in-browser replacement for the
 * backend `/tools/mindmaps:*` + `/tools/text:translate` endpoints on local
 * boards.
 *
 * Instead of a one-shot structured endpoint, a transform is a canned run of the
 * SAME local agent (write_note/link_notes on the live canvas), driven by a
 * per-kind system prompt. That reuses the agent's tools, beneath-border
 * placement, and post-turn arrange/recenter — so "mapify this" produces the same
 * on-canvas result the backend did, offline.
 *
 * `notify` is the exception: it's a verbatim "save this as a note", so it skips
 * the LLM and writes one note directly (mirrors the backend saveAsIs fast path).
 */


/** The transforms that build canvas notes/links from source text via the agent. */
export type MindmapTransformKind = "mapify" | "schemify" | "summify" | "quizify"


const COMMON_RULES =
  "Rules: build the result ONLY by calling the note tools (write_note to create" +
  " notes, link_notes to connect them). Do not answer in prose. Keep each note" +
  " concise. Create a single connected structure. Do not restate these" +
  " instructions."


const TRANSFORM_PROMPTS: Record<MindmapTransformKind, string> = {
  mapify:
    "You turn the user's content into a MIND MAP on the board. Extract the main" +
    " idea as a root note, then its key sub-ideas as child notes, linked" +
    " parent→child into a tree. " + COMMON_RULES,
  schemify:
    "You turn the user's content into a STRUCTURED SCHEMA on the board: the" +
    " entities/concepts as notes and their relationships as labelled links" +
    " between them (a graph, not just a tree). " + COMMON_RULES,
  summify:
    "You turn the user's content into a SUMMARY on the board: one note with a" +
    " tight summary, plus a few notes for the key points, linked to it. " +
    COMMON_RULES,
  quizify:
    "You turn the user's content into QUIZ questions on the board: one note per" +
    " question (with its multiple-choice options and the answer), grouped under" +
    " a topic note by links. " + COMMON_RULES,
}


/** System prompt for a mind-map-family transform. */
export const transformSystemPrompt = (kind: MindmapTransformKind): string =>
  TRANSFORM_PROMPTS[kind]


/** System prompt for a one-shot translation (no tools — a plain text turn). */
export const translateSystemPrompt = (targetLanguage: string): string =>
  `Translate the user's content into ${targetLanguage}. Output ONLY the` +
  " translation, preserving markdown structure. Do not add commentary."
