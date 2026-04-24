import { InlineMath, BlockMath } from "@tiptap/extension-mathematics"
import type MarkdownIt from "markdown-it"


/**
 * Extend InlineMath with tiptap-markdown serialization.
 * Serializes to `\(latex\)`; parse setup adds markdown-it inline rules
 * for both `\(...\)` (canonical) and `$...$` (legacy) that emit
 * `<span data-type="inline-math" data-latex="...">` HTML, which TipTap's
 * InlineMath parseHTML rule picks up.
 */
export const InlineMathMarkdown = InlineMath.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void },
          node: { attrs: { latex: string } },
        ) {
          state.write(`\\(${node.attrs.latex ?? ""}\\)`)
        },
        parse: {
          setup(md: MarkdownIt) {
            // Canonical: \(latex\). Registered before `escape` so the built-in
            // escape rule doesn't consume the leading `\(` before we see it.
            md.inline.ruler.before("escape", "math_inline_bracket", (state, silent) => {
              if (state.src[state.pos] !== "\\") return false
              if (state.src[state.pos + 1] !== "(") return false

              const end = state.src.indexOf("\\)", state.pos + 2)
              if (end === -1) return false

              const latex = state.src.slice(state.pos + 2, end)
              if (!latex || latex.includes("\n")) return false

              if (!silent) {
                const token = state.push("math_inline", "", 0)
                token.content = latex
              }
              state.pos = end + 2
              return true
            })

            // Legacy: $latex$. Kept so notes authored before the delimiter switch still parse as math.
            md.inline.ruler.push("math_inline", (state, silent) => {
              if (state.src[state.pos] !== "$") return false
              if (state.src[state.pos + 1] === "$") return false // block math

              const end = state.src.indexOf("$", state.pos + 1)
              if (end === -1) return false

              const latex = state.src.slice(state.pos + 1, end)
              if (!latex || latex.includes("\n")) return false

              if (!silent) {
                const token = state.push("math_inline", "", 0)
                token.content = latex
              }
              state.pos = end + 1
              return true
            })

            md.renderer.rules["math_inline"] = (_tokens, idx) => {
              const latex = _tokens[idx].content
              return `<span data-type="inline-math" data-latex="${escapeAttr(latex)}"></span>`
            }
          },
        },
      },
    }
  },
})


/**
 * Extend BlockMath with tiptap-markdown serialization.
 * Serializes to `\[\nlatex\n\]`; parse setup adds markdown-it block rules
 * for both `\[...\]` (canonical) and `$$...$$` (legacy) that emit
 * `<div data-type="block-math" data-latex="...">` HTML, which TipTap's
 * BlockMath parseHTML rule picks up.
 */
export const BlockMathMarkdown = BlockMath.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; ensureNewLine: () => void; closeBlock: (node: unknown) => void },
          node: { attrs: { latex: string } },
        ) {
          state.write(`\\[\n${node.attrs.latex ?? ""}\n\\]`)
          state.closeBlock(node)
        },
        parse: {
          setup(md: MarkdownIt) {
            // Canonical: \[ ... \] as a block. Accepts both single-line
            // `\[ expr \]` and multi-line with `\[` / `\]` on their own lines.
            md.block.ruler.before(
              "fence",
              "math_block_bracket",
              (state, startLine, endLine, silent) => {
                const start = state.bMarks[startLine] + state.tShift[startLine]
                const lineText = state.src.slice(start, state.eMarks[startLine]).trim()

                const singleLine = /^\\\[\s*([\s\S]*?)\s*\\\]$/.exec(lineText)
                if (singleLine && singleLine[1]) {
                  if (silent) return true
                  const token = state.push("math_block", "", 0)
                  token.map = [startLine, startLine + 1]
                  token.content = singleLine[1].trim()
                  state.line = startLine + 1
                  return true
                }

                if (lineText !== "\\[") return false
                if (silent) return true

                let nextLine = startLine + 1
                let found = false
                while (nextLine < endLine) {
                  const ls = state.bMarks[nextLine] + state.tShift[nextLine]
                  if (state.src.slice(ls, state.eMarks[nextLine]).trim() === "\\]") {
                    found = true
                    break
                  }
                  nextLine++
                }
                if (!found) return false

                const contentStart = state.bMarks[startLine + 1]
                const contentEnd = state.eMarks[nextLine - 1]
                const latex = state.src.slice(contentStart, contentEnd).trim()

                const token = state.push("math_block", "", 0)
                token.map = [startLine, nextLine + 1]
                token.content = latex
                state.line = nextLine + 1
                return true
              },
              { alt: ["paragraph", "reference", "blockquote", "list"] },
            )

            // Legacy: $$ on its own line, latex, $$ on its own line.
            md.block.ruler.before(
              "fence",
              "math_block",
              (state, startLine, endLine, silent) => {
                const start = state.bMarks[startLine] + state.tShift[startLine]
                const lineText = state.src.slice(start, state.eMarks[startLine])
                if (lineText.trim() !== "$$") return false
                if (silent) return true

                let nextLine = startLine + 1
                let found = false
                while (nextLine < endLine) {
                  const ls = state.bMarks[nextLine] + state.tShift[nextLine]
                  if (state.src.slice(ls, state.eMarks[nextLine]).trim() === "$$") {
                    found = true
                    break
                  }
                  nextLine++
                }
                if (!found) return false

                const contentStart = state.bMarks[startLine + 1]
                const contentEnd = state.eMarks[nextLine - 1]
                const latex = state.src.slice(contentStart, contentEnd).trim()

                const token = state.push("math_block", "", 0)
                token.map = [startLine, nextLine + 1]
                token.content = latex
                state.line = nextLine + 1
                return true
              },
              { alt: ["paragraph", "reference", "blockquote", "list"] },
            )

            md.renderer.rules["math_block"] = (_tokens, idx) => {
              const latex = _tokens[idx].content
              return `<div data-type="block-math" data-latex="${escapeAttr(latex)}"></div>\n`
            }
          },
        },
      },
    }
  },
})


function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
