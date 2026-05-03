import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import { pageSuggestion } from "./page-suggestion"


const pageMentionKey = new PluginKey("pageMentionSuggestion")


/** Wires the `@`-mention Suggestion plugin into the editor. */
export const PageMention = Extension.create({
  name: "pageMention",

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: pageMentionKey,
        ...pageSuggestion,
      }),
    ]
  },
})
