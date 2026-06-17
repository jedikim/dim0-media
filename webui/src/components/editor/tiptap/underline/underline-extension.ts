// Underline mark with markdown round-trip via `<u>…</u>`.
//
// `@tiptap/extension-underline` (bundled in StarterKit) renders the mark
// to `<u>` in the DOM but emits `++text++` when serialized to markdown.
// `tiptap-markdown` v0.9.0 has no parser rule for `++…++`, so the
// underline mark was silently dropped on round-trip: a Ctrl+U edit
// looked correct in-session but reverted to plain text on next load.
//
// Why `<u>…</u>` over `_text_` / `++text++`:
//   - `<u>` is the universal cross-platform underline fallback —
//     supported by GitHub, Notion, Obsidian, Pandoc, and any markdown
//     viewer that respects raw HTML (which is most of them).
//   - Zero collision with existing markdown conventions: `_…_` aliases
//     to italic in CommonMark, `++…++` is a Tiptap-only token, `__…__`
//     means bold everywhere except Discord.
//   - Tiptap itself normalizes ALL underline input (including pasted
//     `<u>` HTML and `text-decoration: underline` inline styles) to
//     `<u>` internally — we're just making the markdown output match.
//
// Note: the legacy `++…++` form that Tiptap's stock serializer used to
// emit is NOT parsed. Underline round-trip was broken before this
// extension landed, so no existing notes have meaningful underline
// content to preserve — dropping `++` keeps the parser tight.

import { markInputRule } from "@tiptap/core"
import { Underline } from "@tiptap/extension-underline"
import type MarkdownIt from "markdown-it"


/**
 * Underline mark with tiptap-markdown round-trip via `<u>…</u>`.
 *
 * Serializes and parses the same canonical form:
 *   <u>text</u>
 */
export const UnderlineMarkdown = Underline.extend({
  /**
   * Real-time `<u>…</u>` input rule. Lets users type the markdown
   * shorthand directly in the editor — no save/reload needed to see
   * the underline applied.
   *
   * Anchored on `</u>$` so the match only fires when the user
   * completes the closing tag; otherwise every `<u>foo` keystroke
   * would briefly look like a match.
   */
  addInputRules() {
    return [
      markInputRule({
        find: /<u>([^<\n]+?)<\/u>$/,
        type: this.type,
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: "<u>",
          close: "</u>",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {
          setup(md: MarkdownIt) {
            // `<u>…</u>` HTML tag form. Inline-only — we intentionally
            // don't match across newlines, mirroring how markdown-it
            // handles other inline marks (emphasis, code).
            md.inline.ruler.after("emphasis", "underline_html", (state, silent) => {
              return matchDelimited(state, silent, "<u>", "</u>")
            })

            md.renderer.rules.underline_open = () => "<u>"
            md.renderer.rules.underline_close = () => "</u>"
          },
        },
      },
    }
  },
})


/**
 * Loosely-typed inline-parser state. markdown-it's `state_inline` carries
 * a lot more than we declare here; we touch only the fields used by the
 * underline rule.
 */
interface InlineState {
  src: string
  pos: number
  posMax: number
  push(type: string, tag: string, nesting: number): { content: string }
  md: { inline: { tokenize(state: InlineState): void } }
}


/**
 * Match a delimited inline span and push underline tokens with the
 * inner content recursively re-tokenized so nested marks (bold,
 * italic, code, …) parse correctly. Returns true if matched +
 * consumed, false if the position didn't start with the open
 * delimiter or no close was found.
 *
 * The inner-content recursion is what distinguishes this from a
 * single-token approach (the highlight extension uses the simpler
 * pattern, which means nested emphasis inside `==…==` doesn't parse —
 * acceptable there because highlights wrap one short phrase, not
 * usually styled text). Underlined-bold is a common combo so we pay
 * the small extra cost.
 *
 * Rejects empty + multi-line spans so the mark stays inline-only.
 */
function matchDelimited(
  state: InlineState,
  silent: boolean,
  open: string,
  close: string,
): boolean {
  if (!state.src.startsWith(open, state.pos)) return false
  const innerStart = state.pos + open.length
  const closeIdx = state.src.indexOf(close, innerStart)
  if (closeIdx === -1) return false

  const inner = state.src.slice(innerStart, closeIdx)
  // Reject empty + multi-line spans — keeps the mark inline-only and
  // avoids accidentally swallowing a paragraph break.
  if (!inner || inner.includes("\n")) return false

  if (!silent) {
    state.push("underline_open", "u", 1)
    // Recursively tokenize the inner content so nested marks (bold,
    // italic, code, links) parse. Save + restore pos / posMax around
    // the recursion so the outer scanner picks up where we stopped.
    const savedPos = state.pos
    const savedPosMax = state.posMax
    state.pos = innerStart
    state.posMax = closeIdx
    state.md.inline.tokenize(state)
    state.pos = savedPos
    state.posMax = savedPosMax
    state.push("underline_close", "u", -1)
  }
  state.pos = closeIdx + close.length
  return true
}
