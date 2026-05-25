/**
 * Subpage directive blocks have this shape (see TipTap's Subpage
 * extension at `editor/tiptap/page/subpage-extension.ts`):
 *
 *     :::page <id>
 *     Title snapshot
 *     :::
 *
 * Streamdown / remark doesn't know about `:::name` directives, so on
 * its own it'd render the literal `:::page abc` text. This helper
 * collapses each block into a regular markdown link with a `page://`
 * scheme — `MarkdownLink` then renders it as a PageRefChip, matching
 * the inline `@page` reference style.
 *
 * We render block-level subpages as inline chips for v1. Sufficient
 * for read-only previews where the visual distinction is minor; an
 * upgrade path (remark-directive + block chip) is documented in the
 * harness migration notes.
 */

// Tolerant pattern: matches both the canonical multi-line form
//   :::page <id>
//   title (one or more lines)
//   :::
// AND the collapsed single-line form
//   :::page <id> title :::
// (which can happen when markdown gets joined / unwrapped somewhere
// upstream). Whitespace between segments is any combination of
// spaces / tabs / newlines.
const SUBPAGE_BLOCK_RE = /:::page[ \t]+(\S+)\s+([\s\S]*?)\s*:::/g


/**
 * Escape characters that have meaning inside a markdown link label.
 * `]` and `\` close / escape the bracket pair; everything else is
 * literal text inside `[…]`.
 */
const escapeLinkText = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")


export const expandPageBlocks = (markdown: string): string => {
  if (!markdown.includes(":::page")) return markdown
  return markdown.replace(SUBPAGE_BLOCK_RE, (_match, id: string, titleBody: string) => {
    // Title may span multiple lines in the block — flatten + trim so
    // the inline chip reads cleanly. Fallback matches the TipTap snap.
    const title = titleBody.replace(/\s+/g, " ").trim() || "Untitled"
    return `[${escapeLinkText(title)}](page://${id})`
  })
}
