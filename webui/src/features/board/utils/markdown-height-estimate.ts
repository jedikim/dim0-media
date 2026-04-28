import {
  estimateMarkdownContentHeight as estimateCanvasMarkdownHeight,
  getMarkdownLineHeightPx,
  type MarkdownHeightEstimateOptions,
} from '@/components/markdown/canvas-lite-markdown'


export {
  estimateCanvasMarkdownHeight as estimateMarkdownContentHeight,
  type MarkdownHeightEstimateOptions,
}


/**
 * Approximate vertical footprint of a single rendered KaTeX block, expressed as
 * a multiple of the active line height. Tunable; chosen to comfortably cover
 * fractions and basic 2-row constructs without being so generous that pure-text
 * nodes look stretched when occasional inline math appears.
 */
const BLOCK_MATH_LINE_FACTOR = 2.5


/**
 * Matches block-style math delimiters at any position in the input. Inline
 * math (single-line `$$...$$` / `\(...\)` / `\[...\]` without a newline) is
 * intentionally not counted here — it sits on the surrounding text line.
 */
const BLOCK_MATH_PATTERN = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/g


/**
 * Counts block math occurrences and returns the input with those blocks removed
 * so the canvas-lite estimator can layout the remaining prose without treating
 * the raw delimiters as wide words.
 */
const splitBlockMath = (text: string): { stripped: string; blockCount: number } => {
  let blockCount = 0
  const stripped = text.replace(BLOCK_MATH_PATTERN, match => {
    if (!match.includes('\n')) return match
    blockCount += 1
    return ''
  })
  return { stripped, blockCount }
}


/**
 * Math-aware extension of the canvas-lite estimator. Delegates prose layout to
 * the canvas tokenizer for pixel parity with display rendering, then adds a
 * flat per-block allowance for KaTeX block math (which the canvas estimator
 * does not model). Inline math is left in place and treated as text — close
 * enough since inline math sits on a normal line.
 */
export const estimateNoteContentHeight = (
  options: MarkdownHeightEstimateOptions
): number => {
  const { text, fontSize = 'M' } = options
  if (!text.trim()) return 0

  const { stripped, blockCount } = splitBlockMath(text)
  const proseHeight = estimateCanvasMarkdownHeight({ ...options, text: stripped })
  if (blockCount === 0) return proseHeight

  const lineHeight = getMarkdownLineHeightPx(fontSize)
  return Math.ceil(proseHeight + blockCount * lineHeight * BLOCK_MATH_LINE_FACTOR)
}
