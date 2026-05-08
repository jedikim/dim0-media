import { useMemo, useRef } from 'react'

import type { LinkEdge } from '../types/flow'
import type { Link } from '../types/link'

type EdgeLabelHandlers = {
  onLabelChange: (value: string) => void
  onLabelSave: () => void
  onLabelCancel: () => void
}

type UseDecoratedEdgesInput = {
  edges: LinkEdge[]
  editingEdgeId: string | null
  edgeLabelDraft: string
  onControlPointChange: (edgeId: string, position: { x: number; y: number }) => void
  labelHandlers: EdgeLabelHandlers
}

type DecorationCacheEntry = {
  input: LinkEdge
  ctrl: (edgeId: string, position: { x: number; y: number }) => void
  output: LinkEdge
}


export function useDecoratedEdges({
  edges,
  editingEdgeId,
  edgeLabelDraft,
  onControlPointChange,
  labelHandlers,
}: UseDecoratedEdgesInput): LinkEdge[] {
  // Per-edge memo: an edge whose identity hasn't changed keeps the same wrapped
  // output across renders, so EdgeView's memo prop diff stays stable.
  const cacheRef = useRef<Map<string, DecorationCacheEntry>>(new Map())

  const edgesWithHandlers = useMemo(() => {
    const cache = cacheRef.current
    const next = new Map<string, DecorationCacheEntry>()

    const result = edges.map(edge => {
      const baseLink = edge.data as Link | undefined
      if (!baseLink) return edge

      const cached = cache.get(edge.id)
      if (cached && cached.input === edge && cached.ctrl === onControlPointChange) {
        next.set(edge.id, cached)
        return cached.output
      }

      const output = {
        ...edge,
        data: {
          ...baseLink,
          onControlPointChange: (position: { x: number; y: number }) =>
            onControlPointChange(edge.id, position),
        } as Link,
      }
      next.set(edge.id, { input: edge, ctrl: onControlPointChange, output })
      return output
    })

    cacheRef.current = next
    return result
  }, [edges, onControlPointChange])

  const edgesForRender = useMemo(() => {
    if (!editingEdgeId) return edgesWithHandlers

    return edgesWithHandlers.map(edge => {
      if (edge.id !== editingEdgeId) return edge
      const baseLink = edge.data as Link | undefined
      if (!baseLink) return edge

      return {
        ...edge,
        data: {
          ...baseLink,
          labelEditing: true,
          labelDraft: edgeLabelDraft,
          onLabelChange: labelHandlers.onLabelChange,
          onLabelSave: labelHandlers.onLabelSave,
          onLabelCancel: labelHandlers.onLabelCancel,
        } as Link,
      }
    })
  }, [
    edgesWithHandlers,
    editingEdgeId,
    edgeLabelDraft,
    labelHandlers.onLabelCancel,
    labelHandlers.onLabelChange,
    labelHandlers.onLabelSave,
  ])

  return edgesForRender
}
