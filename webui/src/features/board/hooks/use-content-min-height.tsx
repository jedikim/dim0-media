import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUpdateNodeInternals } from '@xyflow/react'
import { subscribeMarkdownFontEpoch } from '@/components/markdown/canvas-lite-markdown'
import type { FontFamily, FontSize, NodeType, TextStyle } from '../types/style'
import { contentWidthFromNode, nodeHeightFromContent } from '../utils/note-box'
import { estimateNoteContentHeight } from '../utils/markdown-height-estimate'


type UseNoteMinHeightOptions = {
  text: string
  nodeWidth: number | undefined
  nodeType: NodeType
  fontFamily: FontFamily
  fontSize: FontSize
  textStyle: TextStyle
  floor?: number
  // When false, the hook is a no-op — used for node types that render custom UI
  // (sheets, folders, sandboxes, widgets, etc.) and don't want a text-driven floor.
  enabled?: boolean
}


const DEFAULT_FLOOR = 20
const APPLY_THRESHOLD_PX = 2


/**
 * Pure-compute min-height for note nodes. Replaces the old ResizeObserver hook —
 * the canvas markdown renderer is bitmap-backed and the DOM mirror was either
 * absent (display mode) or in a feedback loop with the rendered size, so the
 * observer never returned useful information. We instead estimate the content
 * height directly from text + style + width using the same tokenize/layout
 * pipeline the renderer uses, mapped through the shared note-box padding helper.
 *
 * The hook applies `style.minHeight` to the React Flow node element so RF's own
 * measurement loop picks it up, and re-runs on font load via the canvas font
 * epoch (canvas measureText returns fallback metrics until custom fonts settle).
 */
export function useContentMinHeight(nodeId: string, options: UseNoteMinHeightOptions) {
  const {
    text,
    nodeWidth,
    nodeType,
    fontFamily,
    fontSize,
    textStyle,
    floor = DEFAULT_FLOOR,
    enabled = true,
  } = options
  const updateNodeInternals = useUpdateNodeInternals()
  const [fontEpoch, setFontEpoch] = useState(0)
  const nodeRef = useRef<HTMLElement | null>(null)
  const lastAppliedMinH = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    return subscribeMarkdownFontEpoch(setFontEpoch)
  }, [enabled])

  const computedMinH = useMemo(() => {
    if (!enabled) return floor
    if (!nodeWidth || nodeWidth <= 0) return floor

    const contentWidth = contentWidthFromNode({ nodeType, nodeWidth })
    const contentHeight = estimateNoteContentHeight({
      text,
      width: contentWidth,
      fontFamily,
      fontSize,
      textStyle,
    })
    if (contentHeight <= 0) return floor

    const required = nodeHeightFromContent({ nodeType, contentHeight })
    return Math.max(floor, required)
    // fontEpoch participates as an invalidation key only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, text, nodeWidth, nodeType, fontFamily, fontSize, textStyle, floor, fontEpoch])

  useLayoutEffect(() => {
    if (!enabled) {
      // If the hook was previously enabled and applied a min-height, clear it
      // so a node that flips from text-shape to a custom-UI type does not keep
      // a stale inline floor. In practice nodeType is stable so this is a
      // safety net rather than a hot path.
      if (lastAppliedMinH.current !== null && nodeRef.current) {
        nodeRef.current.style.minHeight = ''
      }
      lastAppliedMinH.current = null
      return
    }

    const previous = lastAppliedMinH.current
    if (previous !== null && Math.abs(previous - computedMinH) < APPLY_THRESHOLD_PX) return

    if (!nodeRef.current) {
      const selector = `.react-flow__node[data-id="${CSS?.escape ? CSS.escape(nodeId) : nodeId}"]`
      nodeRef.current = document.querySelector<HTMLElement>(selector)
    }
    const el = nodeRef.current
    if (el) el.style.minHeight = `${computedMinH}px`
    lastAppliedMinH.current = computedMinH
    updateNodeInternals(nodeId)
  }, [enabled, nodeId, computedMinH, updateNodeInternals])

  return { computedMinH }
}
