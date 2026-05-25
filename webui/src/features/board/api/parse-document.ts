import camelcaseKeys from "camelcase-keys"
import { apiFetch } from "@/api"
import type { Note } from "../types/note"
import type { Link } from "../types/link"


type ParseDocumentResponse = {
  notes: Note[]
  links: Link[]
}


/**
 * Parse a document and return notes + links. The canvas-harness side
 * calls this from `useHarnessParseDocument`, which then writes the
 * parsed result into the harness store as a `remote`-origin batch.
 */
export async function parseDocument(
  boardId: string,
  file: File,
  rootId?: string,
): Promise<ParseDocumentResponse> {
  const form = new FormData()
  form.append("file", file)

  const res = await apiFetch<{ data: Record<string, unknown> }>({
    path: "/documents",
    method: "POST",
    params: { graph_id: boardId, root_id: rootId },
    body: form,
  })

  const data = camelcaseKeys(res.data, { deep: true })
  return {
    notes: (data.notes ?? []) as Note[],
    links: (data.links ?? []) as Link[],
  }
}
