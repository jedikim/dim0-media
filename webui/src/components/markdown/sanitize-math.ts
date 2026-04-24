// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g
const ESCAPED_MATH_DELIM_RE = /\\\\([()[\]])/g


/**
 * Defensive cleanup for math-bearing markdown from the model/storage layer.
 * Strips C0 control characters that sometimes slip in from streaming (most
 * notably SUB / U+001A, which appears next to delimiters in some model
 * outputs), and collapses over-escaped math delimiters `\\(`, `\\)`, `\\[`,
 * `\\]` back to single-backslash form so downstream parsers recognize them.
 */
export function sanitizeMathDelimiters(src: string): string {
  return src
    .replace(CONTROL_CHARS_RE, "")
    .replace(ESCAPED_MATH_DELIM_RE, "\\$1")
}
