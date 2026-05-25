import { useCallback } from "react"
import { toast } from "sonner"
import type { CanvasStore, NodeId } from "@canvas-harness/core"
import { createDefaultNote } from "@/features/board/types/note"
import { noteToNode } from "../convert/note-to-node"


const ICON_NODE_SIZE = 220


export type AddIconOptions = {
  /** World-space coordinate the icon should be centered on. */
  position?: { x: number; y: number }
}


/**
 * Fetch raw SVG markup for an Iconify icon name (e.g. "lucide:home").
 * Uses Iconify's public CDN — same icon library as our search results.
 * Returns the full `<svg>…</svg>` markup; `null` on network failure or
 * 404 (the caller surfaces a toast).
 */
export const fetchIconSvg = async (iconName: string): Promise<string | null> => {
  const slug = iconName.includes(":") ? iconName.replace(":", "/") : iconName
  try {
    const res = await fetch(`https://api.iconify.design/${slug}.svg`)
    if (!res.ok) return null
    const text = await res.text()
    if (!text.trim().startsWith("<svg")) return null
    return text
  } catch {
    return null
  }
}


/**
 * Harness-native icon insertion. Creates an icon-type Note carrying
 * the Iconify name (for round-trip persistence) and pre-fills the
 * canvas-harness Node's `data.src` with the resolved SVG markup so
 * `paintIconNode` renders immediately. On reload, [use-hydrate-icon-nodes.ts]
 * re-fetches the SVG since we don't persist the markup itself.
 */
export const useHarnessAddIcon = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
) => {
  return useCallback(
    async (iconName: string, options: AddIconOptions = {}): Promise<boolean> => {
      if (!boardId) return false
      const svg = await fetchIconSvg(iconName)
      if (!svg) {
        toast.error(`Couldn't load "${iconName}"`)
        return false
      }
      const note = createDefaultNote({ boardId, nodeType: "icon" })
      if (rootId) note.parentId = rootId
      note.properties.iconData = {
        type: "icon",
        icon: { type: "icon", icon: iconName },
      }
      note.properties.nodeSize = {
        type: "size",
        size: { width: ICON_NODE_SIZE, height: ICON_NODE_SIZE },
      }
      const center = options.position ?? { x: 0, y: 0 }
      note.properties.nodePosition = {
        type: "position",
        position: {
          x: center.x - ICON_NODE_SIZE / 2,
          y: center.y - ICON_NODE_SIZE / 2,
        },
      }
      const node = noteToNode(note)
      // Lift the SVG onto data.src so paintIconNode renders without a
      // second-pass fetch. The SVG itself stays client-side (we don't
      // round-trip it on save — see node-to-note.ts).
      const withSrc = {
        ...node,
        data: {
          ...(node.data as object),
          src: svg,
          alt: iconName,
        },
      }
      store.addNode(withSrc as typeof node)
      // Force select so the user can immediately resize / reposition.
      store.setSelection([withSrc.id as NodeId])
      return true
    },
    [store, boardId, rootId],
  )
}
