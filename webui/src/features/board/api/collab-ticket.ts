import { apiFetch } from "@/api"


export type CollabTicketResponse = {
  ticket: string
  expires_in: number
}


/**
 * Mint a short-lived single-use ticket for opening the collab WebSocket.
 * The server checks board membership; the ticket is consumed on the
 * upgrade and binds (user_id, board_id) so it can't be replayed against
 * a different board.
 */
export async function mintCollabTicket(boardId: string): Promise<CollabTicketResponse> {
  const res = await apiFetch<{ data: CollabTicketResponse }>({
    path: `/boards/${boardId}/collab/ticket`,
    method: "POST",
  })
  return res.data
}
