import type { LinkEdge, NoteNode } from "../types/flow"
import type { Note } from "../types/note"

export type BoardClipboardMode = "copy" | "cut"

export type BoardClipboardPayload = {
  version: 1
  mode: BoardClipboardMode
  copiedAt: string
  sourceBoardId?: string
  sourceRootId?: string
  notes: Note[]
  pointNodes: NoteNode[]
  edges: LinkEdge[]
}

const BOARD_CLIPBOARD_KEY = "topix:board-clipboard"


/**
 * Returns the browser localStorage when available.
 */
const getStorage = () => (typeof window !== "undefined" ? window.localStorage : null)


/**
 * Loads the persisted board clipboard payload, clearing invalid entries.
 */
export const loadBoardClipboard = (): BoardClipboardPayload | null => {
  const storage = getStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(BOARD_CLIPBOARD_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<BoardClipboardPayload>
    if (
      parsed.version !== 1 ||
      (parsed.mode !== "copy" && parsed.mode !== "cut") ||
      !Array.isArray(parsed.notes) ||
      !Array.isArray(parsed.pointNodes) ||
      !Array.isArray(parsed.edges)
    ) {
      storage.removeItem(BOARD_CLIPBOARD_KEY)
      return null
    }

    return {
      version: 1,
      mode: parsed.mode,
      copiedAt: typeof parsed.copiedAt === "string" ? parsed.copiedAt : new Date().toISOString(),
      sourceBoardId: parsed.sourceBoardId,
      sourceRootId: parsed.sourceRootId,
      notes: parsed.notes as Note[],
      pointNodes: parsed.pointNodes as NoteNode[],
      edges: parsed.edges as LinkEdge[],
    }
  } catch {
    storage.removeItem(BOARD_CLIPBOARD_KEY)
    return null
  }
}


/**
 * Persists the current board clipboard payload in localStorage.
 */
export const saveBoardClipboard = (payload: BoardClipboardPayload) => {
  const storage = getStorage()
  if (!storage) return
  storage.setItem(BOARD_CLIPBOARD_KEY, JSON.stringify(payload))
}


/**
 * Removes the persisted board clipboard payload.
 */
export const clearBoardClipboard = () => {
  const storage = getStorage()
  if (!storage) return
  storage.removeItem(BOARD_CLIPBOARD_KEY)
}
