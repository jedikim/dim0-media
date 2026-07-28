/**
 * Markdown-aware chunker for document Q&A (F2 B3).
 *
 * Cuts at semantic seams, mirroring the legacy backend `Chunker`:
 *   - blocks are paragraphs (blank-line separated), and every markdown heading
 *     (`#`..`######`) starts a new block;
 *   - blocks pack greedily up to `maxChars`, but a heading forces a fresh chunk
 *     once the current one is already substantial (>= `minChars`), so a section
 *     stays intact instead of being cut mid-way (legacy "break before the next
 *     title when within size bounds");
 *   - a single block over `maxChars` is split along a separator cascade
 *     (line → word → char) so the cut lands on the best available seam, never
 *     mid-word — unless the content genuinely has no smaller separator.
 * A small `overlap` tail from the previous chunk bridges facts across a boundary.
 * Pure + synchronous so it's trivially testable; ids are assigned by the indexer.
 */


export type Chunk = { index: number; text: string }


// ~1200 chars ≈ a few hundred tokens per chunk; 150-char overlap for continuity.
// minChars gates the heading break: below it, a heading keeps packing (so a doc
// of many tiny sections doesn't shatter into one-line chunks).
const DEFAULT_MAX_CHARS = 1200
const DEFAULT_OVERLAP = 150
const DEFAULT_MIN_FRACTION = 1 / 3

// ATX heading: 1–6 "#" then whitespace (matches the legacy chunker's rule).
const HEADING_RE = /^#{1,6}\s/
// Separator cascade for an oversized block, most→least semantic. "" (chars) is
// the guaranteed terminator. No lookbehind → Safari-safe.
const SEPARATORS = ["\n", " ", ""] as const


/** A paragraph/heading block plus whether it opens a section (its first line is a heading). */
type Block = { text: string; heading: boolean }


/**
 * Split `text` into paragraph blocks (blank-line separated), additionally
 * starting a new block at any heading line — so a heading with no blank line
 * before it (e.g. "# Title\nintro") still begins its own block. Each block
 * records whether it is a heading, decided ONCE here on the raw first line
 * (matching the legacy rule), so the packer never re-tests a trimmed string.
 */
const splitIntoBlocks = (text: string): Block[] => {
  const blocks: Block[] = []
  for (const para of text.split(/\n{2,}/)) {
    let buf: string[] = []
    const flushBuf = (): void => {
      const t = buf.join("\n").trim()
      if (t) blocks.push({ text: t, heading: HEADING_RE.test(buf[0]) })
      buf = []
    }
    for (const line of para.split("\n")) {
      if (HEADING_RE.test(line) && buf.length > 0) flushBuf() // heading opens a block
      buf.push(line)
    }
    flushBuf()
  }
  return blocks
}


/**
 * Split an oversized string into <= maxChars pieces, cutting at the most
 * semantic separator that applies (line, then word, then character). Recurses to
 * a finer separator for any single piece that is still too large.
 */
const splitOversized = (text: string, maxChars: number): string[] => {
  if (text.length <= maxChars) return [text]
  for (const sep of SEPARATORS) {
    const parts = sep === "" ? Array.from(text) : text.split(sep)
    if (parts.length < 2) continue // this separator doesn't apply — go finer

    const out: string[] = []
    let cur = ""
    for (const part of parts) {
      const candidate = cur ? `${cur}${sep}${part}` : part
      if (candidate.length <= maxChars) {
        cur = candidate
        continue
      }
      if (cur) out.push(cur)
      if (part.length <= maxChars) {
        cur = part
      } else {
        out.push(...splitOversized(part, maxChars)) // finer separator
        cur = ""
      }
    }
    if (cur) out.push(cur)
    return out
  }
  return [text] // unreachable: the "" separator always splits a length>1 string
}


/** Split markdown into overlapping chunks. Returns [] for empty/whitespace input. */
export const chunkMarkdown = (
  markdown: string,
  opts: { maxChars?: number; overlap?: number; minChars?: number } = {},
): Chunk[] => {
  const maxChars = Math.max(1, opts.maxChars ?? DEFAULT_MAX_CHARS)
  const overlap = Math.max(0, Math.min(opts.overlap ?? DEFAULT_OVERLAP, maxChars - 1))
  const minChars = Math.max(0, Math.min(opts.minChars ?? Math.floor(maxChars * DEFAULT_MIN_FRACTION), maxChars))

  // Normalize CRLF/CR so paragraph splitting works on PDF exports that use
  // Windows/old-Mac line endings (otherwise `\r\n\r\n` isn't a blank line).
  const text = markdown.replace(/\r\n?/g, "\n").trim()
  if (!text) return []

  const blocks = splitIntoBlocks(text)
  const packed: string[] = []
  const startsSection: boolean[] = [] // chunk[i] opens a new heading section
  let cur = ""
  let curHeading = false // does the block that started `cur` open a section?
  const flush = (): void => {
    if (cur) {
      packed.push(cur)
      startsSection.push(curHeading)
    }
    cur = ""
    curHeading = false
  }

  for (const block of blocks) {
    // Keep a section intact: once the current chunk is substantial, let a heading
    // end it so the new section starts fresh rather than being glued on.
    if (block.heading && cur.length >= minChars) flush()

    if (block.text.length > maxChars) {
      flush()
      // Only the first piece opens the section; the rest are continuations.
      splitOversized(block.text, maxChars).forEach((piece, i) => {
        packed.push(piece)
        startsSection.push(block.heading && i === 0)
      })
      continue
    }
    if (cur && cur.length + 2 + block.text.length > maxChars) flush()
    if (!cur) curHeading = block.heading // this block starts the chunk
    cur = cur ? `${cur}\n\n${block.text}` : block.text
  }
  flush()

  // Prepend the tail of the previous chunk (context bridge across boundaries).
  // Skipped for a chunk that opens a section: the heading break deliberately
  // kept it standalone, so it shouldn't inherit the prior section's tail.
  return packed.map((chunk, index) => {
    if (index === 0 || overlap === 0 || startsSection[index]) return { index, text: chunk }
    return { index, text: `${packed[index - 1].slice(-overlap)}\n\n${chunk}` }
  })
}
