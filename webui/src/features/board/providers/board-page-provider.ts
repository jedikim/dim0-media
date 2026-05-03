import type { Page, PageProvider } from "@/components/editor/tiptap/page/types"
import { listBoardContents } from "../api/list-board-contents"
import { getNote } from "../api/get-note"
import { addNotes } from "../api/add-notes"
import { invalidateBoardContents } from "../api/invalidate-board-contents"
import { createDefaultNote } from "../types/note"


/**
 * Configuration for the editor's PageProvider when running inside the board:
 * a "page" maps to a sheet-kind note in the same board. The `parentNoteId`
 * is used by /subpage to make the new note a child of the current note (the
 * editor host). Reference creation (@mention "Create new") leaves
 * `parentId` unset so the new page is top-level.
 */
export interface BoardPageProviderConfig {
  /** Graph (board) the editor lives in. All page CRUD is scoped to it. */
  boardId: string
  /** ID of the note the editor is currently editing (i.e. potential parent). */
  parentNoteId?: string
  /** Called when the user clicks a page reference chip. */
  onNavigate?: (id: string) => void
}


function snippetFromMarkdown(markdown: string | undefined): string | undefined {
  if (!markdown) return undefined
  // Strip headings, list bullets and excess whitespace for a one-liner peek.
  const stripped = markdown
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
  return stripped.slice(0, 240) || undefined
}


/**
 * Build a `PageProvider` backed by the existing board API helpers.
 * Filters listings to sheet-kind notes (treating sheets as pages); titles
 * are matched case-insensitively client-side since the backend's contents
 * endpoint doesn't support search yet.
 */
export function createBoardPageProvider(
  config: BoardPageProviderConfig,
): PageProvider {
  const { boardId, onNavigate } = config

  return {
    async list(query?: string) {
      const items = await listBoardContents(boardId)
      const sheets: Page[] = items
        .filter((it) => it.kind === "sheet")
        .map((it) => ({ id: it.id, title: it.label?.trim() || "Untitled" }))

      const q = query?.trim().toLowerCase()
      if (!q) return sheets
      return sheets.filter((p) => p.title.toLowerCase().includes(q))
    },

    async get(id: string) {
      try {
        const note = await getNote(boardId, id)
        return {
          id: note.id,
          title: note.label?.markdown?.trim() || "Untitled",
          parentId: note.parentId,
          snippet: snippetFromMarkdown(note.content?.markdown),
        }
      } catch (err) {
        console.warn("[boardPageProvider] get failed", id, err)
        return null
      }
    },

    async create(opts: { title: string; parentId?: string }) {
      const note = createDefaultNote({ boardId, nodeType: "sheet" })
      note.label = { markdown: opts.title || "Untitled" }
      if (opts.parentId) note.parentId = opts.parentId
      await addNotes(boardId, [note])
      // The new sheet is now visible in the parent's contents listing —
      // refresh any sidebar / picker query that's looking at the board.
      invalidateBoardContents(boardId)
      return {
        id: note.id,
        title: opts.title || "Untitled",
        parentId: opts.parentId,
      }
    },

    onNavigate,
  }
}
