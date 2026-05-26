import type { Root, Text, Parent, PhrasingContent } from "mdast"
import { TAG_RE } from "@/components/editor/tiptap/tag/tag-utils"
import { visitTextNodes } from "./mdast-visit"


interface TagSpanNode {
  type: "html"
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


function splitTags(text: string): Array<Text | TagSpanNode> | null {
  if (!text.includes("#")) return null

  const re = new RegExp(TAG_RE.source, "g")
  const out: Array<Text | TagSpanNode> = []
  let last = 0
  let m: RegExpExecArray | null
  let hit = false

  while ((m = re.exec(text)) !== null) {
    hit = true
    if (m.index > last) {
      out.push({ type: "text", value: text.slice(last, m.index) })
    }
    const hasValue = m[2] !== undefined
    const cls = hasValue ? "editor-tag-chip editor-tag-chip--kv" : "editor-tag-chip"
    out.push({
      type: "html",
      value: `<span class="${escapeAttr(cls)}">${escapeText(m[0])}</span>`,
    })
    last = re.lastIndex
  }

  if (!hit) return null
  if (last < text.length) out.push({ type: "text", value: text.slice(last) })
  return out
}


/**
 * remark plugin that decorates `#tag` and `#key:value` tokens as inline
 * chips. Mirrors the TipTap `TagDecoration` plugin so the read-only viewer
 * matches the editor. Code-block / inline-code payloads are skipped for
 * free — mdast doesn't surface them as `text` children.
 *
 * Requires `rehype-raw` downstream so the emitted `<span>` HTML reaches the
 * render tree.
 */
export function remarkTag() {
  return (tree: Root) => {
    const edits: Array<{ parent: Parent; index: number; nodes: PhrasingContent[] }> = []

    visitTextNodes(tree, (node, index, parent) => {
      const segments = splitTags(node.value)
      if (!segments) return
      edits.push({ parent, index, nodes: segments as PhrasingContent[] })
    })

    for (let i = edits.length - 1; i >= 0; i--) {
      const { parent, index, nodes } = edits[i]
      parent.children.splice(index, 1, ...nodes)
    }
  }
}
