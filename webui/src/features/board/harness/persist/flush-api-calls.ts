import { addLinks } from "@/features/board/api/add-links"
import { addNotes } from "@/features/board/api/add-notes"
import { removeLink } from "@/features/board/api/remove-link"
import { removeNote } from "@/features/board/api/remove-note"
import { updateLink } from "@/features/board/api/update-link"
import { updateNote } from "@/features/board/api/update-note"
import type { Note } from "@/features/board/types/note"
import type { ApiCall } from "./diff-snapshots"


/**
 * Drop fields that are either in the URL (`id`) or backend-managed
 * (`graphUid`, `createdAt`) before PATCHing. We keep the real `type`
 * — backend `patch_note` now validates merged payloads against the
 * matching pydantic model (Note or Document) based on the existing
 * row's discriminator, so documents round-trip their type correctly.
 */
const patchableNote = (note: Note): Partial<Note> => {
  const {
    id: _id,
    graphUid: _graphUid,
    createdAt: _createdAt,
    ...rest
  } = note
  void _id
  void _graphUid
  void _createdAt
  return rest
}


/**
 * Execute a batch of diff-derived REST calls against the board API.
 *
 * Ordering rationale:
 *   1. removeLink before removeNote — frees edges before their attached
 *      nodes go, avoiding any backend referential-integrity sensitivity.
 *   2. addNote before addLink — links may reference newly-added nodes.
 *   3. updates last — operate on the post-add steady state.
 *
 * Within each phase, calls run in parallel. addNotes / addLinks are
 * coalesced into one bulk POST each since their endpoints accept arrays.
 */
export const flushApiCalls = async (calls: ApiCall[], boardId: string): Promise<void> => {
  if (calls.length === 0) return

  const removeLinkIds: string[] = []
  const removeNoteIds: string[] = []
  const addNoteBatch: ApiCall[] = []
  const addLinkBatch: ApiCall[] = []
  const updateNotes: ApiCall[] = []
  const updateLinks: ApiCall[] = []

  for (const c of calls) {
    if (c.kind === "removeLink") removeLinkIds.push(c.linkId)
    else if (c.kind === "removeNote") removeNoteIds.push(c.noteId)
    else if (c.kind === "addNote") addNoteBatch.push(c)
    else if (c.kind === "addLink") addLinkBatch.push(c)
    else if (c.kind === "updateNote") updateNotes.push(c)
    else if (c.kind === "updateLink") updateLinks.push(c)
  }

  await Promise.all(removeLinkIds.map((id) => removeLink(boardId, id)))
  await Promise.all(removeNoteIds.map((id) => removeNote(boardId, id)))

  if (addNoteBatch.length > 0) {
    await addNotes(
      boardId,
      addNoteBatch.flatMap((c) => (c.kind === "addNote" ? [c.note] : [])),
    )
  }
  if (addLinkBatch.length > 0) {
    await addLinks(
      boardId,
      addLinkBatch.flatMap((c) => (c.kind === "addLink" ? [c.link] : [])),
    )
  }

  await Promise.all(
    updateNotes.map((c) =>
      c.kind === "updateNote"
        ? updateNote(boardId, c.note.id, patchableNote(c.note))
        : Promise.resolve(),
    ),
  )
  await Promise.all(
    updateLinks.map((c) =>
      c.kind === "updateLink" ? updateLink(boardId, c.link.id, c.link) : Promise.resolve(),
    ),
  )
}
