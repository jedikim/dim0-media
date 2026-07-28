import { useEffect, useRef } from "react"
import { type CanvasStore, type Node, type Op } from "@canvas-harness/core"
import { makeBatch } from "@/features/board/harness/make-batch"
import { useMindMapStore } from "@/features/agent/store/mindmap-store"
import type { LinkEdge, NoteNode } from "@/features/board/types/flow"
import type { Link } from "@/features/board/types/link"
import type { Note } from "@/features/board/types/note"
import { linkToEdge } from "../convert/link-to-edge"
import { noteToNode } from "../convert/note-to-node"


/**
 * Drains pending AI mindmaps from `useMindMapStore` into the
 * canvas-harness store. Replaces the legacy
 * `useAddMindMapToBoard` flow (which lived in the unmounted
 * react-flow `graph-editor.tsx` and silently no-op'd on harness).
 *
 * Subscribes to mindmap-store changes; when entries exist for the
 * active board, converts the staged NoteNodes / LinkEdges to
 * canvas-harness Nodes / Edges and applies them as a single
 * `local`-origin op batch. The normal debounced-save loop then
 * POSTs them to the server.
 *
 * Skips the prod-only point-node materialization — canvas-harness
 * stores edge attachments natively via `EdgeEnd.localOffset`, so
 * each edge attaches at the source/target node's center.
 */
export const useHarnessApplyMindMap = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
): void => {
  const drainingRef = useRef(false)

  useEffect(() => {
    if (!boardId) return

    const drain = (): void => {
      if (drainingRef.current) return
      const state = useMindMapStore.getState()
      const pending = state.mindmaps.get(boardId)
      if (!pending || pending.length === 0) return

      drainingRef.current = true
      try {
        const ops: Op[] = []
        for (const mindmap of pending) {
          const { nodes, edges } = mindmap
          const harnessNodes = convertStagedNodes(nodes, rootId, boardId)
          const nodeMap = new Map(
            harnessNodes.map((n) => [n.id as unknown as string, n]),
          )
          for (const node of harnessNodes) {
            ops.push({ type: "node.add", node })
          }
          for (const edge of edges) {
            const link = stagedEdgeToLink(edge, rootId, boardId)
            if (!link) continue
            const harnessEdge = linkToEdge(link, nodeMap)
            ops.push({ type: "edge.add", edge: harnessEdge })
          }
        }
        if (ops.length > 0) {
          store.applyBatch(makeBatch(store, "local", ops))
        }
        state.clearMindMap(boardId)
      } finally {
        drainingRef.current = false
      }
    }

    // Initial drain in case a mindmap was staged before this hook mounted.
    drain()

    return useMindMapStore.subscribe((next, prev) => {
      const a = prev.mindmaps.get(boardId)?.length ?? 0
      const b = next.mindmaps.get(boardId)?.length ?? 0
      if (b > a) drain()
    })
  }, [store, boardId, rootId])
}


/**
 * Convert a staged NoteNode (react-flow shape with .data = Note, plus
 * .position / .width / .height set by autoLayout) into a canvas-harness
 * Node via the harness convert layer. AutoLayout's position/size are
 * lifted onto `note.properties` so `noteToNode` reads them naturally.
 */
const convertStagedNodes = (
  nodes: readonly NoteNode[],
  rootId: string | null,
  boardId: string,
): Node[] => {
  const out: Node[] = []
  for (const nn of nodes) {
    const data = nn.data as Note | undefined
    if (!data) continue
    const position = nn.position ?? data.properties?.nodePosition?.position ?? { x: 0, y: 0 }
    const width =
      typeof nn.width === "number" && Number.isFinite(nn.width)
        ? nn.width
        : data.properties?.nodeSize?.size?.width ?? 200
    const height =
      typeof nn.height === "number" && Number.isFinite(nn.height)
        ? nn.height
        : data.properties?.nodeSize?.size?.height ?? 120
    const note: Note = {
      ...data,
      graphUid: boardId,
      parentId: rootId ?? undefined,
      properties: {
        ...data.properties,
        nodePosition: { type: "position", position },
        nodeSize: { type: "size", size: { width, height } },
      },
    }
    out.push(noteToNode(note))
  }
  return out
}


/**
 * Build a Link from a staged LinkEdge, applying scope. Source/target on
 * the staged edge are real note ids (AI Spark doesn't materialize
 * point nodes); the harness `linkToEdge` resolves them to attached
 * `EdgeEnd`s at node center.
 */
const stagedEdgeToLink = (
  edge: LinkEdge,
  rootId: string | null,
  boardId: string,
): Link | null => {
  const data = edge.data
  if (!data) return null
  return {
    ...data,
    source: edge.source,
    target: edge.target,
    graphUid: boardId,
    parentId: rootId ?? undefined,
  }
}
