import { Details, DetailsSummary, DetailsContent } from "@tiptap/extension-details"
import { InputRule } from "@tiptap/core"
import { TextSelection } from "@tiptap/pm/state"
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

  /**
   * Notion-style shortcut: typing `> ` at the start of a line converts the
   * current block into a toggle. The blockquote extension's matching input
   * rule is disabled in extensions.ts so the two don't collide.
   */
  addInputRules() {
    return [
      new InputRule({
        find: /^>\s$/,
        handler: ({ state, range, chain }) => {
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .setDetails()
            .run()
          void state
        },
      }),
    ]
  },

  /**
   * Cmd/Ctrl+Enter while inside a toggle's summary opens the toggle and
   * drops the caret into its content area, ready to type the body. The
   * Details NodeView reconciles `is-open` and the `hidden` attribute on
   * detailsContent inside its `update` callback — but that runs in the
   * same frame as PM's selection rendering, so a single combined
   * transaction races and the caret can't land in still-hidden content.
   * Splitting the work across two frames lets the DOM finish flipping
   * before we move the caret.
   *
   * Spread `this.parent?.()` so the Details extension's default Enter
   * handler (creates a paragraph below a closed toggle, splits inside
   * detailsContent) keeps working.
   */
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      "Mod-Enter": ({ editor }) => {
        const { state } = editor
        const { $from } = state.selection

        let summaryDepth = -1
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "detailsSummary") {
            summaryDepth = d
            break
          }
        }
        if (summaryDepth < 0) return false
        const detailsDepth = summaryDepth - 1
        if (detailsDepth < 0) return false
        const detailsNode = $from.node(detailsDepth)
        if (detailsNode.type.name !== "details") return false

        const detailsPos = $from.before(detailsDepth)
        const summaryNode = $from.node(summaryDepth)
        const detailsContentPos =
          $from.before(summaryDepth) + summaryNode.nodeSize
        const detailsContentNode = state.doc.nodeAt(detailsContentPos)
        if (
          !detailsContentNode ||
          detailsContentNode.type.name !== "detailsContent"
        ) {
          return false
        }

        // Frame 1: just open the toggle. Let the NodeView reconcile the
        // is-open class and the hidden attribute on detailsContent.
        const openTr = state.tr.setNodeMarkup(detailsPos, undefined, {
          ...detailsNode.attrs,
          open: true,
        })
        editor.view.dispatch(openTr)

        // Frame 2: with the content now visibly mounted, move the caret.
        // Recompute the position from the *current* doc — the dispatch
        // above could have shifted positions if any decorations changed.
        requestAnimationFrame(() => {
          if (editor.isDestroyed) return
          const view = editor.view
          // Walk to find the detailsContent again from the original details
          // pos, since the doc may have been re-evaluated.
          const refreshedDetails = view.state.doc.nodeAt(detailsPos)
          if (
            !refreshedDetails ||
            refreshedDetails.type.name !== "details"
          ) {
            return
          }
          // First child is detailsSummary; its size lets us find the
          // detailsContent's open token, then +2 to land inside the first
          // paragraph.
          const summary = refreshedDetails.firstChild
          if (!summary) return
          const innerStart = detailsPos + 1 + summary.nodeSize + 2
          if (innerStart > view.state.doc.content.size) return
          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.doc, innerStart),
          )
          view.dispatch(tr.scrollIntoView())
        })
        return true
      },
    }
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
