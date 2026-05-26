/**
 * TOC directive blocks (`:::toc\n:::`) are interactive in the TipTap editor
 * (live-computed heading list). In the read-only markdown view they're a
 * no-op for now — strip the block from the source so remark doesn't render
 * the literal `:::toc` text. If we want a static "On this page" list in the
 * viewer later, this is the seam where it'd be emitted.
 */

const TOC_BLOCK_RE = /^:::toc[ \t]*\n:::[ \t]*$/gm


export const expandTocBlocks = (markdown: string): string => {
  if (!markdown.includes(":::toc")) return markdown
  return markdown.replace(TOC_BLOCK_RE, "")
}
