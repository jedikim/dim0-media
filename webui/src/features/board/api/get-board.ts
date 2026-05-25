import type { Graph } from "../types/board"
import camelcaseKeys from "camelcase-keys"
import { apiFetch } from "@/api"
import type { Link } from "../types/link"
import type { Note } from "../types/note"


/**
 * Fetch a board by its ID. Returns the graph + canEdit flag. The
 * canvas-harness store calls this from `hydrateBoardStore` on scope
 * change.
 */
export async function getBoard(
  boardId: string,
  rootId?: string,
): Promise<{ graph: Graph; canEdit: boolean }> {
  const res = await apiFetch<{ data: Record<string, unknown> }>({
    path: `/boards/${boardId}`,
    method: "GET",
    params: { root_id: rootId },
  })
  const data = camelcaseKeys(res.data, { deep: true })
  return {
    graph: data.graph as Graph,
    canEdit: data.canEdit !== false,
  }
}


/**
 * Fetch a single note from a board.
 */
export async function getBoardNote(
  boardId: string,
  noteId: string,
): Promise<Note> {
  const res = await apiFetch<{ data: Record<string, unknown> }>({
    path: `/boards/${boardId}/notes/${noteId}`,
    method: "GET",
  })
  const data = camelcaseKeys(res.data, { deep: true })
  return data.note as Note
}


/**
 * Fetch a single link (edge) from a board by id.
 */
export async function getBoardLink(
  boardId: string,
  linkId: string,
): Promise<Link> {
  const res = await apiFetch<{ data: Record<string, unknown> }>({
    path: `/boards/${boardId}/links/${linkId}`,
    method: "GET",
  })
  const data = camelcaseKeys(res.data, { deep: true })
  return data.link as Link
}
