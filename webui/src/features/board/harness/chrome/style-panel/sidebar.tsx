import { useCallback, useMemo } from "react"
import type {
  Edge,
  EdgeId,
  EdgeStyle,
  Node,
  PathStyle,
  Style as CanvasStyle,
} from "@canvas-harness/core"
import { useCanvasStore, useEdges, useNodes, useSelection } from "@canvas-harness/react"
import { useTheme } from "@/components/theme-provider"
import type { LinkEdgeData } from "../../convert/link-to-edge"
import {
  adaptEdgeColors,
  applyColorsToEdgeStyle,
  applyColorsToStyle,
  type StoredColors,
  type StoredEdgeColors,
} from "../../theme/color-adapter"
import { computeNodeColorUpdate, storedNodeColorsOf } from "../../theme/apply-node-colors"
import type { NoteNodeData } from "../../convert/note-to-node"
import { StylePanel, type StylePanelStyle } from "./panel"


/** The three color fields that round-trip through `data._storedColors`. */
const NODE_COLOR_FIELDS = ["strokeColor", "backgroundColor", "textColor"] as const
type NodeColorField = (typeof NODE_COLOR_FIELDS)[number]


const EDGE_COLOR_FIELDS = ["strokeColor", "textColor"] as const
type EdgeColorField = (typeof EDGE_COLOR_FIELDS)[number]


/** Lift stored edge colors off an Edge, falling back to `edge.style`. */
const storedEdgeColorsOf = (e: Edge): StoredEdgeColors => {
  const data = e.data as Partial<LinkEdgeData> | undefined
  return (
    data?._storedColors ?? {
      strokeColor: e.style?.strokeColor,
      textColor: e.style?.textColor,
    }
  )
}


/**
 * Reads the current selection from canvas-harness and dispatches style
 * changes back to it. Edge selection wins only when the selection has
 * no nodes — otherwise we show the node panel (mixed-selection UX:
 * nodes first, matches Excalidraw).
 *
 * Color fields go through the dark-mode split (stored on data, projected
 * onto style for the current mode) so theme toggles never dirty the
 * server. Edge-only fields (`pathStyle`) live on `Edge` itself, not in
 * `style` — the dispatch helper routes them through the right slot.
 */
export function StyleSidebar() {
  const selection = useSelection()
  const allNodes = useNodes()
  const allEdges = useEdges()
  const store = useCanvasStore()
  const { resolvedTheme } = useTheme()

  const selectedNodes = useMemo<Node[]>(() => {
    if (selection.length === 0) return []
    const ids = new Set(selection as string[])
    return allNodes.filter((n) => ids.has(n.id as unknown as string) && n.type !== "frame")
  }, [selection, allNodes])

  const selectedEdges = useMemo<Edge[]>(() => {
    if (selection.length === 0 || selectedNodes.length > 0) return []
    const ids = new Set(selection as string[])
    return allEdges.filter((e) => ids.has(e.id as unknown as string))
  }, [selection, selectedNodes, allEdges])

  const kind: "node" | "edge" | null =
    selectedNodes.length > 0 ? "node" : selectedEdges.length > 0 ? "edge" : null

  // Representative style fed to the panel — for nodes, overlay stored
  // colors on display so the picker shows the user's pick. For edges,
  // same idea plus we lift `pathStyle` (which lives on Edge itself,
  // not in `style`) onto the panel snapshot.
  const representativeStyle = useMemo<StylePanelStyle | undefined>(() => {
    if (kind === "node") {
      const first = selectedNodes[0]
      if (!first?.style) return undefined
      return applyColorsToStyle(first.style, storedNodeColorsOf(first))
    }
    if (kind === "edge") {
      const first = selectedEdges[0]
      if (!first) return undefined
      const baseStyle = first.style ?? {}
      const withStored = applyColorsToEdgeStyle(baseStyle, storedEdgeColorsOf(first)) as EdgeStyle
      return { ...withStored, pathStyle: first.pathStyle }
    }
    return undefined
  }, [kind, selectedNodes, selectedEdges])

  const handleNodeStyleChange = useCallback(
    (patch: Partial<StylePanelStyle>) => {
      const colorPatch: Partial<StoredColors> = {}
      const rest: Partial<CanvasStyle> = { ...patch }
      // Strip edge-only keys that have no place on a node.
      delete (rest as Record<string, unknown>).pathStyle
      delete (rest as Record<string, unknown>).sourceArrowhead
      delete (rest as Record<string, unknown>).targetArrowhead
      for (const k of NODE_COLOR_FIELDS) {
        if (k in patch) {
          colorPatch[k] = patch[k as NodeColorField] ?? undefined
          delete rest[k]
        }
      }
      const hasColor = Object.keys(colorPatch).length > 0
      const hasRest = Object.keys(rest).length > 0

      const mode = resolvedTheme === "dark" ? "dark" : "light"
      store.batch(() => {
        for (const n of selectedNodes) {
          const baseStyle = hasRest ? { ...n.style, ...rest } : n.style ?? {}
          if (hasColor) {
            const { style, data } = computeNodeColorUpdate(n, colorPatch, mode, baseStyle)
            store.updateNode(n.id, { style, data })
          } else {
            // Non-color change (border, font, …). `baseStyle` still carries OUR
            // theme's display colors, so attach the canonical `_storedColors` too
            // — otherwise a peer in a different theme applies our colors verbatim
            // (theme leak). Mirrors the edge handler, which always sends them.
            store.updateNode(n.id, {
              style: baseStyle,
              data: { ...((n.data ?? {}) as NoteNodeData), _storedColors: storedNodeColorsOf(n) },
            })
          }
        }
      })
    },
    [store, selectedNodes, resolvedTheme],
  )

  const handleEdgeStyleChange = useCallback(
    (patch: Partial<StylePanelStyle>) => {
      const colorPatch: Partial<StoredEdgeColors> = {}
      const rest: Partial<EdgeStyle> = { ...patch } as Partial<EdgeStyle>
      // pathStyle lives on Edge itself, not in style — pull it out.
      const pathStylePatch =
        "pathStyle" in patch ? (patch.pathStyle as PathStyle | undefined) : undefined
      delete (rest as Record<string, unknown>).pathStyle
      for (const k of EDGE_COLOR_FIELDS) {
        if (k in patch) {
          colorPatch[k] = patch[k as EdgeColorField] ?? undefined
          delete (rest as Record<string, unknown>)[k]
        }
      }
      const hasColor = Object.keys(colorPatch).length > 0
      const hasRest = Object.keys(rest).length > 0
      const hasPath = pathStylePatch !== undefined

      store.batch(() => {
        for (const e of selectedEdges) {
          const prevStored = storedEdgeColorsOf(e)
          const nextStored: StoredEdgeColors = hasColor
            ? { ...prevStored, ...colorPatch }
            : prevStored
          const displayColors =
            resolvedTheme === "dark" ? adaptEdgeColors(nextStored, "dark") : nextStored
          const baseStyle: EdgeStyle = hasRest
            ? ({ ...e.style, ...rest } as EdgeStyle)
            : (e.style ?? {})
          const nextStyle = hasColor
            ? applyColorsToEdgeStyle(baseStyle, displayColors)
            : baseStyle
          const nextData: LinkEdgeData = {
            ...((e.data ?? {}) as LinkEdgeData),
            _storedColors: nextStored,
          }
          const update: Parameters<typeof store.updateEdge>[1] = {
            style: nextStyle,
            data: nextData,
          }
          if (hasPath) update.pathStyle = pathStylePatch
          store.updateEdge(e.id as EdgeId, update)
        }
      })
    },
    [store, selectedEdges, resolvedTheme],
  )

  if (!kind || !representativeStyle) return null

  return (
    <div className="pointer-events-auto absolute left-3 top-1/2 z-50 w-[160px] -translate-y-1/2">
      <StylePanel
        kind={kind}
        style={representativeStyle}
        onStyleChange={kind === "node" ? handleNodeStyleChange : handleEdgeStyleChange}
      />
    </div>
  )
}
