import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { TAG_RE } from "./tag-utils"


const key = new PluginKey("tagDecoration")


/**
 * TipTap extension that decorates #tag and #key:value tokens as inline chips.
 * Skips text inside code blocks and inline code marks.
 */
export const TagDecoration = Extension.create({
  name: "tagDecoration",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const re = new RegExp(TAG_RE.source, "g")

            state.doc.descendants((node, pos, parent) => {
              if (parent?.type.name === "codeBlock") return false
              if (!node.isText || !node.text) return
              if (node.marks.some((m) => m.type.name === "code")) return

              re.lastIndex = 0
              let m: RegExpExecArray | null
              while ((m = re.exec(node.text)) !== null) {
                const from = pos + m.index
                const to = from + m[0].length
                const hasValue = m[2] !== undefined
                decorations.push(
                  Decoration.inline(from, to, {
                    class: hasValue ? "editor-tag-chip editor-tag-chip--kv" : "editor-tag-chip",
                  }),
                )
              }
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
