/**
 * Document-citation helpers (F2 B7) — pure, render-time, non-mutating.
 *
 * Sources are derived from what `doc_search` actually returned this turn (keyed
 * by the unique `docId`), NOT parsed from the answer text — so a citation can
 * never be ambiguous or mis-repaired. Titles are unique per board, so an exact
 * title occurrence in the answer can be safely linkified to its document.
 */
import type { AgentResponse } from "../types/stream"
import { isToolCallStep } from "../types/stream"


/** A cited document: its unique id, label, and the passages the agent retrieved. */
export type DocSource = { docId: string; docTitle: string; passages: string[] }


/**
 * Collect the distinct documents `doc_search` surfaced across an answer's steps,
 * in first-seen order, each with its retrieved passages (deduped). Keyed by
 * `docId` so same-title docs never merge.
 */
export const extractDocSources = (answer: AgentResponse): DocSource[] => {
  const byId = new Map<string, DocSource>()
  for (const step of answer.steps) {
    if (!isToolCallStep(step) || typeof step.output === "string" || step.output.type !== "doc_search") {
      continue
    }
    for (const ref of step.output.references) {
      if (!ref.docId) continue
      const existing = byId.get(ref.docId)
      const passage = ref.text.trim()
      if (existing) {
        if (passage && !existing.passages.includes(passage)) existing.passages.push(passage)
      } else {
        byId.set(ref.docId, {
          docId: ref.docId,
          docTitle: ref.docTitle,
          passages: passage ? [passage] : [],
        })
      }
    }
  }
  return [...byId.values()]
}


const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")


// Neutralize a title before it becomes the label of an emitted `[label](…)`.
// Two passes: (1) backslash-escape markdown-active chars so "a*b_.pdf" renders
// as literal text instead of emphasis / code; (2) HTML-entity-encode & < >
// so a title carrying raw HTML (e.g. "<img src=x onerror=…>.pdf" from an
// attacker-controlled file name) renders as literal text rather than reaching
// MarkdownView's raw-HTML pipeline as active markup. "[" and "]" are handled by
// skipping such titles entirely. `&` is encoded first so `<`/`>` don't double-encode.
const escapeMarkdownLabel = (s: string): string =>
  s
    .replace(/[\\`*_]/g, "\\$&")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")


/**
 * The DOM id of a document's Sources card. Namespaced by the message so a
 * multi-turn chat that cites the same document across messages doesn't produce
 * duplicate ids (which would make an in-answer link jump to the wrong message).
 */
export const docAnchorId = (messageId: string, docId: string): string => `doc-${messageId}-${docId}`


/**
 * Wrap exact occurrences of a cited document's title in the answer markdown with
 * a link to its Sources anchor (`#${docAnchorId(messageId, docId)}`). Non-mutating
 * in spirit: only exact title strings are decorated, longest-first so a title
 * that contains another isn't half-matched, and occurrences already inside a
 * markdown link `](...)` are left alone. Unknown references are simply not linked.
 */
export const linkifyDocTitles = (markdown: string, sources: DocSource[], messageId: string): string => {
  // Skip empty titles, and titles carrying a "[" or "]" (they'd break the
  // emitted `[label](…)` markdown — brackets aren't safely escapable in a label).
  const titled = sources.filter((s) => s.docTitle.trim().length > 0 && !/[[\]]/.test(s.docTitle))
  if (titled.length === 0) return markdown
  // Longest titles first so "Report v2.pdf" wins over "Report".
  const ordered = [...titled].sort((a, b) => b.docTitle.length - a.docTitle.length)

  let out = markdown
  for (const s of ordered) {
    const title = escapeRegExp(s.docTitle)
    // Boundaries. Leading edge WITHOUT a lookbehind (Safari <16.4 lacks it):
    // capture start-of-string or a char that is neither a word char nor "[",
    // and re-emit it. Trailing edge is a lookahead (supported everywhere).
    //  - leading `(^|[^\w[])` → not a substring ("notes.pdf" in "mynotes.pdf")
    //    and not already inside a link ("[title]").
    //  - trailing `(?![\w]|\]\()` → not "Report.pdfx", and no double-wrap.
    const re = new RegExp(`(^|[^\\w[])(${title})(?![\\w]|\\]\\()`, "g")
    const href = `#${docAnchorId(messageId, s.docId)}`
    out = out.replace(re, (_m, pre: string, match: string) => `${pre}[${escapeMarkdownLabel(match)}](${href})`)
  }
  return out
}
