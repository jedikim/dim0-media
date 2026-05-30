import { apiFetch } from "@/api"


export type ShareRole = "member" | "viewer"


export type ShareLink = {
  token: string
  role: ShareRole
  created_at: string
}


export type BoardMember = {
  user_uid: string
  email: string
  role: "owner" | "member" | "viewer"
  joined_at: string | null
}


/** Mint a new share link with the requested role. Owner-only. */
export async function mintShareLink(boardId: string, role: ShareRole): Promise<{ token: string; role: ShareRole }> {
  const res = await apiFetch<{ data: { token: string; role: ShareRole } }>({
    path: `/boards/${boardId}/share-links`,
    method: "POST",
    body: { role },
  })
  return res.data
}


/** List active share links for the board. Owner-only. */
export async function listShareLinks(boardId: string): Promise<ShareLink[]> {
  const res = await apiFetch<{ data: { links: ShareLink[] } }>({
    path: `/boards/${boardId}/share-links`,
    method: "GET",
  })
  return res.data.links
}


/** Revoke a single share link by token. */
export async function revokeShareLink(boardId: string, token: string): Promise<void> {
  await apiFetch<{ data: { revoked: boolean } }>({
    path: `/boards/${boardId}/share-links/${encodeURIComponent(token)}`,
    method: "DELETE",
  })
}


/** Revoke every active share link on the board ("Disable sharing"). */
export async function revokeAllShareLinks(boardId: string): Promise<number> {
  const res = await apiFetch<{ data: { revoked_count: number } }>({
    path: `/boards/${boardId}/share-links`,
    method: "DELETE",
  })
  return res.data.revoked_count
}


/** List members + viewers + owner of a board. Owner-only. */
export async function listBoardMembers(boardId: string): Promise<BoardMember[]> {
  const res = await apiFetch<{ data: { members: BoardMember[] } }>({
    path: `/boards/${boardId}/members`,
    method: "GET",
  })
  return res.data.members
}


/**
 * Remove a member or viewer from the board. Owner-only.
 * Also closes any live WS sessions that user has open on the board.
 */
export async function removeBoardMember(
  boardId: string,
  userUid: string,
): Promise<{ removed: true; kicked_sessions: number }> {
  const res = await apiFetch<{ data: { removed: true; kicked_sessions: number } }>({
    path: `/boards/${boardId}/members/${encodeURIComponent(userUid)}`,
    method: "DELETE",
  })
  return res.data
}


/** Peek at what a share link grants without consuming it. */
export async function previewShareLink(
  token: string,
): Promise<{ graph_uid: string; role: ShareRole }> {
  const res = await apiFetch<{ data: { graph_uid: string; role: ShareRole } }>({
    path: `/share-links/${encodeURIComponent(token)}/preview`,
    method: "GET",
  })
  return res.data
}


/** Consume a share link for the signed-in user. */
export async function acceptShareLink(
  token: string,
): Promise<{ graph_uid: string; role: string; already_member: boolean }> {
  const res = await apiFetch<{ data: { graph_uid: string; role: string; already_member: boolean } }>({
    path: `/share-links/${encodeURIComponent(token)}/accept`,
    method: "POST",
  })
  return res.data
}


/** Build the URL a user clicks to land on `/share/<token>`. */
export function shareLinkUrl(token: string): string {
  if (typeof window === "undefined") return `/share/${token}`
  return `${window.location.origin}/share/${token}`
}
