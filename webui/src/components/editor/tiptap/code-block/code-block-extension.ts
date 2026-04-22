import CodeBlock from "@tiptap/extension-code-block"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { CodeBlockView } from "./code-block-view"

/** Extends TipTap's CodeBlock with a Shiki-powered React NodeView. */
export const ShikiCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})
