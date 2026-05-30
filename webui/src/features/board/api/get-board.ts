import type { Graph } from "../types/board"
import camelcaseKeys from "camelcase-keys"
import { apiFetch } from "@/api"
import type { Link } from "../types/link"
import type { Note } from "../types/note"


/** The user's role on the loaded board; `null` for public-visibility access. */
export type BoardRole = "owner" | "member" | "viewer" | null


/**
 * Fetch a board by its ID. Returns the graph + canEdit + role.
 * canvas-harness store calls this from `hydrateBoardStore` on scope change.
 *
 * `role` is the user's explicit role from `graph_user` ("owner",
 * "member", or "viewer"), or `null` if the user has no row (public-
 * visibility browsing). The Share button gates on `role === "owner"`.
 */
export async function getBoard(
  boardId: string,
  rootId?: string,
): Promise<{ graph: Graph; canEdit: boolean; role: BoardRole }> {
  const res = await apiFetch<{ data: Record<string, unknown> }>({
    path: `/boards/${boardId}`,
    method: "GET",
    params: { root_id: rootId },
  })
  const data = camelcaseKeys(res.data, { deep: true })
  const role = data.role as BoardRole
  return {
    graph: data.graph as Graph,
    canEdit: data.canEdit !== false,
    role: role ?? null,
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
