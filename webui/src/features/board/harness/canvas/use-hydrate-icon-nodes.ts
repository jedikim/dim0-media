import { useEffect } from "react"
import {
  type CanvasStore,
  type Node,
  type NodeId,
  type Op,
} from "@canvas-harness/core"
import { makeBatch } from "@/features/board/harness/make-batch"
import { fetchIconSvg } from "./use-add-icon"


type IconNodeData = {
  src?: string
  alt?: string
  properties?: {
    iconData?: {
      icon?: {
        type?: "icon" | "emoji"
        icon?: string
        emoji?: string
      }
    }
  }
}


/**
 * Read the Iconify name from an icon-type Node. We don't persist the
 * raw SVG markup on save (`node-to-note.ts` strips it), so on reload
 * the node arrives with `data.properties.iconData.icon.icon` but no
 * `data.src` — this picks the Iconify name out.
 */
const iconNameOf = (node: Node): string | null => {
  if (node.type !== "icon") return null
  const data = node.data as IconNodeData | undefined
  if (!data) return null
  if (data.src) return null
  const icon = data.properties?.iconData?.icon
  if (!icon || icon.type !== "icon" || !icon.icon) return null
  return icon.icon
}


/**
 * On board hydrate, scans for icon-type Nodes that arrived without
 * `data.src` (the SVG markup paintIconNode needs) and re-fetches the
 * Iconify SVG for each. Applied as a `remote`-origin batch so the
 * debounced save loop skips it — the SVG stays client-side, the
 * server only stores the Iconify name.
 */
export const useHydrateIconNodes = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
  ready: boolean,
): void => {
  useEffect(() => {
    if (!ready || !boardId) return
    let cancelled = false

    const run = async (): Promise<void> => {
      const targets: { id: NodeId; iconName: string; node: Node }[] = []
      for (const node of store.getAllNodes()) {
        const iconName = iconNameOf(node)
        if (iconName) targets.push({ id: node.id, iconName, node })
      }
      if (targets.length === 0) return

      const results = await Promise.all(
        targets.map(async (t) => {
          const svg = await fetchIconSvg(t.iconName)
          return { ...t, svg }
        }),
      )
      if (cancelled) return

      const ops: Op[] = []
      for (const r of results) {
        if (!r.svg) continue
        const fresh = store.getNode(r.id)
        if (!fresh) continue
        const prev = fresh
        const nextData = {
          ...(fresh.data as object),
          src: r.svg,
          alt: r.iconName,
        }
        ops.push({
          type: "node.update",
          id: r.id,
          patch: { data: nextData } as Partial<Node>,
          prev,
        })
      }
      if (ops.length === 0) return

      store.applyBatch(makeBatch(store, "remote", ops))
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [store, boardId, rootId, ready])
}
