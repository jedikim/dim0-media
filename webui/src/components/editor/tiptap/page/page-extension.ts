import { Extension } from "@tiptap/core"
import type { PageProvider } from "./types"


/**
 * Holds the host-provided PageProvider plus the id of the note the editor
 * is currently editing. Page-related extensions (suggestion, NodeViews,
 * slash commands) read both via `editor.storage.pageProvider.{provider,
 * parentNoteId}`. `parentNoteId` is what `/subpage` uses to create a
 * child of the current note.
 */
export const PageProviderExtension = Extension.create<{
  provider: PageProvider | null
  parentNoteId: string | null
}>({
  name: "pageProvider",

  addOptions() {
    return { provider: null, parentNoteId: null }
  },

  addStorage() {
    return {
      provider: this.options.provider,
      parentNoteId: this.options.parentNoteId,
    }
  },
})
