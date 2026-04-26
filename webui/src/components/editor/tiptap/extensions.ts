import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import CharacterCount from "@tiptap/extension-character-count"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import Link from "@tiptap/extension-link"
import Underline from "@tiptap/extension-underline"
import Typography from "@tiptap/extension-typography"
import { Markdown } from "tiptap-markdown"
import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { keymap } from "@tiptap/pm/keymap"
import { sinkListItem, liftListItem } from "@tiptap/pm/schema-list"
import Highlight from "@tiptap/extension-highlight"
import { DetailsMarkdown, DetailsSummaryMarkdown, DetailsContentMarkdown } from "./toggle/toggle-extensions"
import { TableKit } from "@tiptap/extension-table"
import { ShikiCodeBlock } from "./code-block/code-block-extension"
import { InlineMathMarkdown, BlockMathMarkdown } from "./math/math-extensions"
import { openMathEditor } from "./math/math-edit-popover"
import { TagDecoration } from "./tag/tag-decoration"
import { slashSuggestion } from "./slash-command/suggestion"
import "katex/dist/katex.min.css"

const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...slashSuggestion,
      }),
    ]
  },
})

/** Traps Tab inside the editor using a raw ProseMirror keymap for reliability. */
const TabHandler = Extension.create({
  name: "tabHandler",
  addProseMirrorPlugins() {
    return [
      keymap({
        Tab: (state, dispatch) => {
          const { $from } = state.selection

          // Walk ancestors — reliable check regardless of NodeView context
          for (let d = $from.depth; d >= 0; d--) {
            if ($from.node(d).type.name === "codeBlock") {
              if (dispatch) dispatch(state.tr.insertText("\t"))
              return true
            }
          }

          // List items via prosemirror-schema-list commands
          const li = state.schema.nodes.listItem
          const ti = state.schema.nodes.taskItem
          if (li && sinkListItem(li)(state, dispatch)) return true
          if (ti && sinkListItem(ti)(state, dispatch)) return true

          return true // consume Tab — no focus escape
        },
        "Shift-Tab": (state, dispatch) => {
          const li = state.schema.nodes.listItem
          const ti = state.schema.nodes.taskItem
          if (li && liftListItem(li)(state, dispatch)) return true
          if (ti && liftListItem(ti)(state, dispatch)) return true
          return true
        },
      }),
    ]
  },
})

export function getExtensions(placeholder = "Start writing…") {
  return [
    StarterKit.configure({
      // Phase 1: undo/redo enabled. When adding Yjs: set undoRedo: false and add @tiptap/extension-collaboration
      codeBlock: false, // replaced by ShikiCodeBlock
    }),
    ShikiCodeBlock,
    InlineMathMarkdown.configure({
      onClick: (node, pos) =>
        openMathEditor({ pos, latex: node.attrs.latex ?? "", isInline: true }),
    }),
    BlockMathMarkdown.configure({
      onClick: (node, pos) =>
        openMathEditor({ pos, latex: node.attrs.latex ?? "", isInline: false }),
    }),
    Highlight.configure({ multicolor: false }),
    DetailsMarkdown,
    DetailsSummaryMarkdown,
    DetailsContentMarkdown,
    TagDecoration,
    TableKit,
    Placeholder.configure({ placeholder }),
    CharacterCount,
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: "editor-link" },
    }),
    Underline,
    Typography,
    Markdown.configure({
      html: false,
      transformCopiedText: true,
      transformPastedText: true,
    }),
    SlashCommand,
    TabHandler, // must be last — highest priority in TipTap's keymap chain
  ]
}
