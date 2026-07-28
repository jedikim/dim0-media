import type { Op } from "@canvas-harness/core"
import { apiFetch } from "@/api"


export type AdoptBoardResult = {
  graphId: string
  adopted: boolean
  applied: number
}


/**
 * Adopt a local board into a synced graph (local → synced), preserving its id.
 *
 * Sends the board's full content as a batch of wire add-ops to the server's
 * `:adopt` endpoint, which creates the graph under the caller and rebuilds it.
 * Idempotent server-side, so a retried promotion is safe.
 */
export async function adoptBoard(
  boardId: string,
  ops: Op[],
  label?: string,
): Promise<AdoptBoardResult> {
  const res = await apiFetch<{ data: { graph_id: string; adopted: boolean; applied: number } }>({
    path: `/boards/${boardId}:adopt`,
    method: "POST",
    body: { ops, label },
  })
  return {
    graphId: res.data.graph_id,
    adopted: res.data.adopted,
    applied: res.data.applied,
  }
}
