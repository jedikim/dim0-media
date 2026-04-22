import { Details, DetailsSummary, DetailsContent } from "@tiptap/extension-details"
import type MarkdownIt from "markdown-it"


/**
 * Details (toggle container) with tiptap-markdown serialization.
 * Serializes as:
 *   :::toggle Summary title
 *   Content paragraph here.
 *   :::
 */
export const DetailsMarkdown = Details.extend({
  addOptions() {
    return { ...this.parent!(), persist: true }
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            write: (s: string) => void
            renderContent: (node: unknown) => void
            ensureNewLine: () => void
            closeBlock: (node: unknown) => void
          },
          node: { firstChild: { textContent: string } | null; lastChild: unknown },
        ) {
          const summary = node.firstChild?.textContent ?? ""
          state.write(`:::toggle ${summary}\n`)
          if (node.lastChild) state.renderContent(node.lastChild as never)
          state.ensureNewLine()
          state.write(":::")
          state.closeBlock(node)
        },
        parse: {
          setup(md: MarkdownIt) {
            md.block.ruler.before(
              "fence",
              "toggle_block",
              (state, startLine, endLine, silent) => {
                const startPos = state.bMarks[startLine] + state.tShift[startLine]
                const lineText = state.src.slice(startPos, state.eMarks[startLine])
                if (!lineText.startsWith(":::toggle")) return false
                if (silent) return true

                const summary = lineText.slice(9).trim()
                let closeLine = -1
                for (let i = startLine + 1; i < endLine; i++) {
                  const lp = state.bMarks[i] + state.tShift[i]
                  if (state.src.slice(lp, state.eMarks[i]).trim() === ":::") {
                    closeLine = i
                    break
                  }
                }
                if (closeLine === -1) return false

                // Render content lines as nested markdown-it tokens
                const contentSrc = state.src
                  .split("\n")
                  .slice(startLine + 1, closeLine)
                  .join("\n")

                // Use md.parse() to avoid mutating StateBlock (prototype methods like skipEmptyLines would break on spread)
                const innerTokens = state.md.parse(contentSrc, state.env)
                const innerHtml = state.md.renderer.render(innerTokens, state.md.options, state.env)
                const token = state.push("html_block", "", 0)
                token.map = [startLine, closeLine + 1]
                token.content = `<details open><summary>${escapeHtml(summary)}</summary><div>${innerHtml}</div></details>\n`

                state.line = closeLine + 1
                return true
              },
              { alt: ["paragraph", "reference", "blockquote"] },
            )
          },
        },
      },
    }
  },
})


/** DetailsSummary — no standalone serialization needed (handled by parent). */
export const DetailsSummaryMarkdown = DetailsSummary.extend({
  addStorage() {
    return {
      markdown: {
        serialize() { /* parent Details handles the whole block */ },
      },
    }
  },
})


/** DetailsContent — transparent wrapper; parent handles serialization. */
export const DetailsContentMarkdown = DetailsContent.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { renderContent: (node: unknown) => void },
          node: unknown,
        ) {
          state.renderContent(node as never)
        },
      },
    }
  },
})


function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
