import type { Root, Text, Parent, PhrasingContent } from "mdast"
import { isAllowedColor, isNamedColor } from "@/components/editor/tiptap/highlight/highlight-extension"
import { visitTextNodes } from "./mdast-visit"


/**
 * Matches `==text==` with an optional `color:` prefix inside the marks.
 * The whole-string capture for color is validated against the allowlist
 * after the regex match — anything that doesn't pass (e.g. `http`) falls
 * back to a plain default-color highlight, matching the editor's
 * markdown-it parser (toggle-side at `highlight-extension.ts:131-140`).
 */
const HIGHLIGHT_RE = /==([^=\n]+?)==/g


interface MarkNode {
  type: "html"
  // We piggy-back on a real HTML node so remark-rehype turns it into a `mark`
  // element without needing a custom mdast type. The viewer pipeline runs
  // `rehype-raw` already (for the toggle preprocessor's <details>), so the
  // inline `<mark>` tags get parsed and exposed to the components map.
  value: string
}


const escapeAttr = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")


const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")


function splitHighlights(text: string): Array<Text | MarkNode> | null {
  if (!text.includes("==")) return null

  const out: Array<Text | MarkNode> = []
  const re = new RegExp(HIGHLIGHT_RE.source, "g")
  let last = 0
  let m: RegExpExecArray | null
  let hit = false

  while ((m = re.exec(text)) !== null) {
    hit = true
    if (m.index > last) {
      out.push({ type: "text", value: text.slice(last, m.index) })
    }

    const inner = m[1]
    let color: string | null = null
    let content = inner
    const colonIdx = inner.indexOf(":")
    if (colonIdx > 0) {
      const candidate = inner.slice(0, colonIdx)
      if (isAllowedColor(candidate)) {
        color = candidate
        content = inner.slice(colonIdx + 1)
      }
    }

    let attrs = ""
    if (color) {
      attrs = ` data-color="${escapeAttr(color)}"`
      if (!isNamedColor(color)) {
        attrs += ` style="background-color: ${escapeAttr(color)}; color: inherit"`
      }
    }
    out.push({
      type: "html",
      value: `<mark${attrs}>${escapeText(content)}</mark>`,
    })
    last = re.lastIndex
  }

  if (!hit) return null
  if (last < text.length) out.push({ type: "text", value: text.slice(last) })
  return out
}


/**
 * remark plugin that rewrites `==text==` (with optional `color:` or `#hex:`
 * prefix) into inline `<mark>` HTML nodes. Mirrors the TipTap
 * `HighlightMarkdown` extension's parser so editor and viewer stay in sync.
 *
 * Requires `rehype-raw` downstream so the emitted HTML reaches the rendered
 * tree. Code-block content is skipped for free — mdast doesn't expose `code`
 * payloads as `text` nodes.
 */
export function remarkHighlight() {
  return (tree: Root) => {
    const edits: Array<{ parent: Parent; index: number; nodes: PhrasingContent[] }> = []

    visitTextNodes(tree, (node, index, parent) => {
      const segments = splitHighlights(node.value)
      if (!segments) return
      edits.push({ parent, index, nodes: segments as PhrasingContent[] })
    })

    // Apply replacements last-first so earlier indices stay valid.
    for (let i = edits.length - 1; i >= 0; i--) {
      const { parent, index, nodes } = edits[i]
      parent.children.splice(index, 1, ...nodes)
    }
  }
}
