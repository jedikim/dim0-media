import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import type MarkdownIt from "markdown-it"
import { TocBlockView } from "./toc-block-view"


/**
 * `tableOfContents` block — a non-editable atom that renders a live list
 * of the doc's headings. Inserted via the `/toc` slash command. The list
 * itself is recomputed from the doc every render, so the saved markdown
 * only needs to remember "there's a TOC here", not a snapshot of headings.
 *
 * Markdown round-trip uses a `:::toc` directive (mirrors the toggle
 * `:::toggle` shape).
 */
export const TocBlock = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "table-of-contents" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            write: (s: string) => void
            ensureNewLine: () => void
            closeBlock: (node: unknown) => void
          },
          node: unknown,
        ) {
          state.write(":::toc")
          state.ensureNewLine()
          state.write(":::")
          state.closeBlock(node)
        },
        parse: {
          setup(md: MarkdownIt) {
            md.block.ruler.before(
              "fence",
              "toc_block",
              (state, startLine, endLine, silent) => {
                const startPos = state.bMarks[startLine] + state.tShift[startLine]
                const lineText = state.src
                  .slice(startPos, state.eMarks[startLine])
                  .trim()
                if (lineText !== ":::toc") return false
                if (silent) return true

                let nextLine = startLine + 1
                let found = false
                while (nextLine < endLine) {
                  const ls = state.bMarks[nextLine] + state.tShift[nextLine]
                  if (state.src.slice(ls, state.eMarks[nextLine]).trim() === ":::") {
                    found = true
                    break
                  }
                  nextLine++
                }
                if (!found) return false

                const token = state.push("html_block", "", 0)
                token.map = [startLine, nextLine + 1]
                token.content = `<div data-type="table-of-contents"></div>\n`
                state.line = nextLine + 1
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
