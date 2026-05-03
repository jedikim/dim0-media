import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import type MarkdownIt from "markdown-it"
import { SubpageView } from "./subpage-view"


function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}


/**
 * Block-level subpage embed. Stored as a directive:
 *
 *   :::page <id>
 *   Title snapshot
 *   :::
 *
 * On parse-back the markdown-it block rule emits an HTML stub that the
 * node's parseHTML rule turns into a `subpage` atom with `pageId` /
 * `title` attrs. The displayed title is resolved live in the NodeView,
 * so the snapshot only matters as fallback / for non-aware viewers.
 */
export const Subpage = Node.create({
  name: "subpage",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      pageId: { default: "" },
      title: { default: "Untitled" },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="subpage"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false
          return {
            pageId: el.getAttribute("data-page-id") ?? "",
            title: el.textContent?.trim() || "Untitled",
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "subpage",
        "data-page-id": node.attrs.pageId,
      }),
      node.attrs.title || "Untitled",
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubpageView)
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
          node: { attrs: { pageId?: string; title?: string } },
        ) {
          const id = node.attrs.pageId ?? ""
          const title = (node.attrs.title || "Untitled").replace(/[\r\n]+/g, " ")
          state.write(`:::page ${id}`)
          state.ensureNewLine()
          state.write(title)
          state.ensureNewLine()
          state.write(":::")
          state.closeBlock(node)
        },
        parse: {
          setup(md: MarkdownIt) {
            md.block.ruler.before(
              "fence",
              "subpage_block",
              (state, startLine, endLine, silent) => {
                const startPos = state.bMarks[startLine] + state.tShift[startLine]
                const lineText = state.src
                  .slice(startPos, state.eMarks[startLine])
                  .trim()
                if (!lineText.startsWith(":::page")) return false
                if (silent) return true

                const id = lineText.slice(":::page".length).trim()
                if (!id) return false

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

                const titleSrc = state.src
                  .split("\n")
                  .slice(startLine + 1, nextLine)
                  .join(" ")
                  .trim()
                const title = titleSrc || "Untitled"

                const token = state.push("html_block", "", 0)
                token.map = [startLine, nextLine + 1]
                token.content =
                  `<div data-type="subpage" data-page-id="${escHtml(id)}">` +
                  `${escHtml(title)}</div>\n`

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
