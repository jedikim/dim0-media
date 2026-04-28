import { Image } from "@tiptap/extension-image"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { ReactNodeViewRenderer } from "@tiptap/react"
import type MarkdownIt from "markdown-it"
import { insertImageFromFile } from "./insert-image"
import { ImageNodeView } from "./image-node-view"


const imageDropKey = new PluginKey("imageDrop")


/**
 * Image node + ProseMirror plugin that handles drag-and-drop and paste of
 * image files. Both paths hand off to `insertImageFromFile`, which mirrors
 * the canvas pipeline (downscale → upload → insert).
 */
export const ImageWithDrop = Image.extend({
  addOptions() {
    return {
      ...this.parent!(),
      inline: false,
      allowBase64: true,
      HTMLAttributes: { class: "editor-image" },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },

  addStorage() {
    return {
      markdown: {
        // The default prosemirror-markdown image serializer assumes the image
        // sits inside a paragraph and so omits closeBlock. Our image is
        // block-level; without closeBlock the next block (e.g. a code fence)
        // glues onto the same line and the doc breaks on reload.
        serialize(
          state: {
            write: (s: string) => void
            esc: (s: string) => string
            closeBlock: (node: unknown) => void
          },
          node: { attrs: { src?: string; alt?: string; title?: string } },
        ) {
          const alt = (node.attrs.alt ?? "").replace(/[\r\n]+/g, " ")
          // Normalize before encoding so serialization is idempotent across
          // save/parse cycles. Decode iteratively (capped) — a single pass
          // only unwinds one layer (e.g. %2520 → %20 still leaves an encoded
          // '%'). After fully decoding, encodeURI produces one canonical
          // encoded form regardless of how many times the doc has been saved.
          const rawSrc = node.attrs.src ?? ""
          let literal = rawSrc
          for (let i = 0; i < 5; i++) {
            try {
              const next = decodeURI(literal)
              if (next === literal) break
              literal = next
            } catch {
              break
            }
          }
          const src = encodeURI(literal)
          const title = node.attrs.title
          state.write(
            `![${state.esc(alt)}](${src}${title ? ` "${state.esc(title)}"` : ""})`,
          )
          state.closeBlock(node)
        },
        parse: {
          setup(md: MarkdownIt) {
            // Markdown-it's default validateLink rejects `file:` URLs, so a
            // freshly-saved `![alt](file:///…)` round-trips back as plain text
            // on reload. Whitelist `file:` so server filePaths survive parse.
            const original = md.validateLink.bind(md)
            md.validateLink = (url: string) =>
              url.startsWith("file:") ? true : original(url)
          },
        },
      },
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: imageDropKey,
        props: {
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files ?? []).filter(
              (f) => f.type.startsWith("image/"),
            )
            if (files.length === 0) return false

            const dropPos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })?.pos
            // Refuse drops inside code blocks — image markup is invalid there.
            if (dropPos != null) {
              const $pos = view.state.doc.resolve(dropPos)
              for (let d = $pos.depth; d >= 0; d--) {
                if ($pos.node(d).type.name === "codeBlock") return false
              }
            }

            event.preventDefault()
            for (const file of files) {
              void insertImageFromFile(editor, file, dropPos)
            }
            return true
          },

          handlePaste(_view, event) {
            const files = Array.from(event.clipboardData?.files ?? []).filter(
              (f) => f.type.startsWith("image/"),
            )
            if (files.length === 0) return false

            event.preventDefault()
            for (const file of files) {
              void insertImageFromFile(editor, file)
            }
            return true
          },
        },
      }),
    ]
  },
})
