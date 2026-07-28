/**
 * Content-fit node sizing — a port of the backend `text_measure.estimate_node_size`
 * (topix/.../text_measure.py). Heuristic, canvas-free: a char-count model that
 * grows height to fit wrapped markdown and shrinks width toward the natural line
 * width. Applied at creation so agent notes aren't all the same default box.
 *
 * Only text shapes are content-sized; sheet/mini-app/widget/code-sandbox keep
 * their fixed defaults (their views render a preview, not the raw content).
 */


// Canvas node types whose box should fit their text content.
const CONTENT_SIZED = new Set(["rect", "ellipse", "diamond"])


// Font model (CSS px), matching the backend's medium size.
const FONT_SIZE = 16
const LINE_HEIGHT = 24
const CHAR_W = 0.55 * FONT_SIZE // average glyph advance
const HORIZONTAL_PADDING = 12
const CONTENT_HEIGHT_BUFFER = 4
const MAX_HEIGHT = 4000
const MIN_WIDTH = 120


// Interior width factor (text fits an inscribed region) + min aspect per shape.
const WIDTH_FACTOR: Record<string, number> = { rect: 1, ellipse: 0.7, diamond: 0.707 }
const MIN_ASPECT: Record<string, number> = { ellipse: 1, diamond: 1 }


/** Lines a single logical line wraps to at the given width. */
const wrapCount = (line: string, maxWidth: number): number => {
  const perLine = Math.max(1, Math.floor(maxWidth / CHAR_W))
  if (line.length === 0) return 1
  let lines = 0
  let col = 0
  for (const word of line.split(/\s+/).filter(Boolean)) {
    if (word.length > perLine) {
      if (col > 0) lines += 1
      lines += Math.ceil(word.length / perLine)
      col = 0
    } else if (col + word.length + (col > 0 ? 1 : 0) > perLine) {
      lines += 1
      col = word.length
    } else {
      col += word.length + (col > 0 ? 1 : 0)
    }
  }
  return Math.max(1, lines + (col > 0 ? 1 : 0))
}


/** Estimated rendered height of markdown content at a given box width. */
const estimateHeight = (content: string, width: number): number => {
  const inner = Math.max(20, width - 2 * HORIZONTAL_PADDING)
  const total = content.split("\n").reduce((sum, line) => sum + wrapCount(line, inner) * LINE_HEIGHT, 0)
  return Math.min(MAX_HEIGHT, Math.max(LINE_HEIGHT, total) + CONTENT_HEIGHT_BUFFER)
}


/** Natural (unwrapped) pixel width of the widest line, markdown markers stripped. */
const naturalWidth = (content: string): number => {
  const longest = content
    .split("\n")
    .map((l) => l.replace(/[*_`#~>=-]+/g, "").trim().length)
    .reduce((a, b) => Math.max(a, b), 0)
  return longest * CHAR_W
}


/**
 * Fit a note's width/height to its content for content-sized shapes. Returns
 * null for fixed-size types (caller keeps the default). Width shrinks toward the
 * content's natural width, clamped to [MIN_WIDTH, defaultWidth]; height grows to
 * fit; shapes enforce a min aspect so ellipses/diamonds stay legible.
 */
export const estimateNoteSize = (
  nodeType: string,
  defaultWidth: number,
  content: string,
): { width: number; height: number } | null => {
  if (!CONTENT_SIZED.has(nodeType) || !content.trim()) return null

  const factor = WIDTH_FACTOR[nodeType] ?? 1
  const boxWidth = (naturalWidth(content) + HORIZONTAL_PADDING) / factor
  const width = Math.max(MIN_WIDTH, Math.min(defaultWidth, Math.ceil(boxWidth)))

  let height = estimateHeight(content, width * factor)
  const aspect = MIN_ASPECT[nodeType]
  if (aspect) height = Math.max(height, width * aspect)

  return { width, height: Math.ceil(height) }
}
