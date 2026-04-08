import { useCallback, useState } from 'react'
import type { ReactFlowState } from '@xyflow/react'
import { useStore } from '@xyflow/react'
import { useGraphStore } from '../store/graph-store'
import { buildLinePlacement } from '../utils/line-placement'
import { useStyleDefaults } from '../style-provider'

type Point = { x: number; y: number }

export function usePlaceLine() {
  const [pending, setPending] = useState(false)
  const boardId = useGraphStore(state => state.boardId)
  const rootId = useGraphStore(state => state.rootId)
  const setNodes = useGraphStore(state => state.setNodes)
  const setEdgesPersist = useGraphStore(state => state.setEdgesPersist)
  const internalNodes = useStore((state: ReactFlowState) => state.nodeLookup)
  const { applyDefaultLinkStyle } = useStyleDefaults()

  const begin = useCallback(() => {
    setPending(true)
  }, [])

  const cancel = useCallback(() => {
    setPending(false)
  }, [])

  const place = useCallback((start: Point, end: Point) => {
    if (!boardId) return
    const { pointNodes, edge } = buildLinePlacement({
      start,
      end,
      boardId,
      rootId,
      internalNodes,
      style: applyDefaultLinkStyle()
    })
    if (pointNodes.length > 0) {
      setNodes(prev => [...prev, ...pointNodes])
    }
    setEdgesPersist(prev => [...prev, edge])
    setPending(false)
  }, [boardId, rootId, internalNodes, setEdgesPersist, setNodes, applyDefaultLinkStyle])

  return {
    pending,
    begin,
    cancel,
    place,
  }
}
