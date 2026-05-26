/**
 * Toggle directive blocks have this shape (mirrors TipTap's Details extension
 * at `editor/tiptap/toggle/toggle-extensions.ts`):
 *
 *     :::toggle Summary text
 *     body paragraph 1
 *
 *     body paragraph 2
 *     :::
 *
 * Streamdown / remark doesn't know about `:::name` directives, so on its own
 * it'd render the literal text. This helper rewrites each block into a raw
 * HTML `<details>` element with blank lines around the body so remark
 * re-enters markdown parsing for the inner content. Requires `rehype-raw`
 * in the rendering pipeline.
 */

// Non-greedy body match. Closing `:::` must be on its own line — guards against
// false matches and lets streaming chunks render literally until the block
// closes. Multiline + global so multiple toggles per doc work.
const TOGGLE_BLOCK_RE = /^:::toggle[ \t]+(.+)\n([\s\S]*?)\n:::[ \t]*$/gm


const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")


export const expandToggleBlocks = (markdown: string): string => {
  // Cheap gate: skip the regex entirely if neither marker is present.
  // During streaming the closer arrives last, so we also skip while the
  // doc has `:::toggle` but no subsequent `:::` (avoids scanning the
  // tail of every partial chunk).
  if (!markdown.includes(":::toggle")) return markdown
  if (!markdown.includes("\n:::")) return markdown

  return markdown.replace(TOGGLE_BLOCK_RE, (_match, summary: string, body: string) => {
    const trimmedSummary = summary.trim()
    // Blank lines inside the HTML block let remark re-parse the inner body
    // as markdown (CommonMark type-6 HTML block rules).
    return `<details open>\n<summary>${escapeHtml(trimmedSummary)}</summary>\n\n${body}\n\n</details>`
  })
}
