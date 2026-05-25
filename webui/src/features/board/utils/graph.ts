import { uuidToNumber } from "@/lib/common"
import type { LinkEdge, NoteNode } from "../types/flow"
import { createDefaultLinkProperties, type Link } from "../types/link"
import type { Document } from "../types/document"
import { createDefaultNoteProperties, type Note } from "../types/note"


/**
 * Convert a server Note / Document into the legacy react-flow node
 * shape used by the AI mindmap pipeline. The mindmap store stages
 * these shapes; `useHarnessApplyMindMap` reads + converts them to
 * canvas-harness nodes when draining.
 */
export const convertNoteToNode = (note: Note | Document): NoteNode => {
  const position = note.properties?.nodePosition?.position || { x: 0, y: 0 }
  const fallbackSize = { width: 300, height: 100 }
  const size = note.properties?.nodeSize?.size || (
    note.type === "note"
      ? createDefaultNoteProperties({ type: note.style.type }).nodeSize.size ?? fallbackSize
      : fallbackSize
  )
  const zIndex =
    note.type === "note" ? note.properties?.nodeZIndex?.number || 0 : 0

  const noteId = String(note.id)

  if (note.type === "document") {
    const width = size.width
    const height = size.height
    const roughSeed = uuidToNumber(noteId)

    return {
      id: noteId,
      type: "document",
      position,
      data: { ...note, roughSeed } as unknown as NoteNode["data"],
      selected: false,
      draggable: true,
      height: height,
      width: width,
      measured: { width: width, height: height },
      zIndex: zIndex,
    }
  }

  const type = note.style.type
  const width = size.width
  const height = size.height

  const roughSeed = uuidToNumber(noteId)

  return {
    id: noteId,
    type: 'default',
    position,
    data: { ...note, roughSeed } as unknown as NoteNode["data"],
    selected: false,
    draggable: true,
    height: height,
    width: width,
    measured: { width: width, height: height },
    zIndex: type === 'slide' ? -1000 : zIndex
  }
}


/**
 * Convert a server Link into the legacy react-flow edge shape. Same
 * mindmap-pipeline contract as `convertNoteToNode`.
 */
export const convertLinkToEdge = (link: Link): LinkEdge => {
  return {
    id: link.id,
    type: 'default',
    source: link.source,
    target: link.target,
    data: {
      ...link,
      properties: link.properties ?? createDefaultLinkProperties(),
    },
    selected: false,
    animated: false,
  }
}
