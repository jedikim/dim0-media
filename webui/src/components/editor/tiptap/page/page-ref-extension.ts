import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import type MarkdownIt from "markdown-it"
import { PageRefView } from "./page-ref-view"


function escMd(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")
}


function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}


/**
 * Inline page-reference node. Stored in markdown as a regular link with a
 * `page://` scheme — `[Title snapshot](page://<id>)` — so non-aware
 * markdown viewers still render something readable.
 */
export const PageRef = Node.create({
  name: "pageRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      pageId: { default: "" },
      title: { default: "Untitled" },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-type="page-ref"]',
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
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-type": "page-ref",
        "data-page-id": node.attrs.pageId,
        href: `page://${encodeURIComponent(node.attrs.pageId)}`,
      }),
      node.attrs.title || "Untitled",
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageRefView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void },
          node: { attrs: { pageId?: string; title?: string } },
        ) {
          const id = node.attrs.pageId ?? ""
          const title = node.attrs.title || "Untitled"
          state.write(`[${escMd(title)}](page://${encodeURIComponent(id)})`)
        },
        parse: {
          setup(md: MarkdownIt) {
            // Hijack the link renderer so `page://...` links emit our
            // `<a data-type="page-ref">` HTML — TipTap's parseHTML rule
            // above then converts it into a pageRef node on parse-back.
            const defaultRender = md.renderer.rules.link_open
              ?? ((tokens, idx, options, _env, self) =>
                  self.renderToken(tokens, idx, options))

            md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
              const token = tokens[idx]
              const href = token.attrGet("href") ?? ""
              if (!href.startsWith("page://")) {
                return defaultRender(tokens, idx, options, env, self)
              }
              const id = decodeURIComponent(href.slice("page://".length))
              return `<a data-type="page-ref" data-page-id="${escHtml(id)}">`
            }
          },
        },
      },
    }
  },
})
