import type { NodeGeometry } from './flow'
import type { GraphStore } from '../store/graph-store'

export type EdgeNodeSlice = {
  x: number
  y: number
  w: number
  h: number
  shape: NodeGeometry['shape']
  attachedToNodeId?: string
}


function toEdgeNodeShape(type: unknown): NodeGeometry['shape'] {
  if (type === 'ellipse' || type === 'layered-circle') return 'ellipse'
  if (type === 'diamond' || type === 'soft-diamond' || type === 'layered-diamond') return 'diamond'
  return 'rectangle'
}


export function selectEdgeNodeSlice(nodeId: string) {
  return (state: GraphStore): EdgeNodeSlice | null => {
    const node = state.nodesById.get(nodeId)
    if (!node) return null
    const styleType = (node.data as { style?: { type?: string } } | undefined)?.style?.type
    return {
      x: node.position.x,
      y: node.position.y,
      w: node.measured?.width ?? node.width ?? 1,
      h: node.measured?.height ?? node.height ?? 1,
      shape: toEdgeNodeShape(styleType),
      attachedToNodeId: (node.data as { attachedToNodeId?: string } | undefined)?.attachedToNodeId,
    }
  }
}


/**
 * Flat-primitive selector that returns every field an EdgeView needs across the
 * source, target, and their attached-clip nodes in a single record. All values
 * are primitives so `useShallow` can compare reliably with one subscription
 * instead of four.
 */
export type FlatEdgeSlices = {
  sExists: boolean
  sx: number
  sy: number
  sw: number
  sh: number
  sShape: NodeGeometry['shape']
  sAttachedToId?: string

  tExists: boolean
  tx: number
  ty: number
  tw: number
  th: number
  tShape: NodeGeometry['shape']
  tAttachedToId?: string

  asExists: boolean
  asx: number
  asy: number
  asw: number
  ash: number
  asShape: NodeGeometry['shape']

  atExists: boolean
  atx: number
  aty: number
  atw: number
  ath: number
  atShape: NodeGeometry['shape']
}


export function selectEdgeAllSlices(source: string, target: string) {
  return (state: GraphStore): FlatEdgeSlices => {
    const sn = state.nodesById.get(source)
    const tn = state.nodesById.get(target)
    const sAttached = sn ? (sn.data as { attachedToNodeId?: string } | undefined)?.attachedToNodeId : undefined
    const tAttached = tn ? (tn.data as { attachedToNodeId?: string } | undefined)?.attachedToNodeId : undefined
    const asn = sAttached ? state.nodesById.get(sAttached) : undefined
    const atn = tAttached ? state.nodesById.get(tAttached) : undefined

    return {
      sExists: !!sn,
      sx: sn ? sn.position.x : 0,
      sy: sn ? sn.position.y : 0,
      sw: sn ? (sn.measured?.width ?? sn.width ?? 1) : 0,
      sh: sn ? (sn.measured?.height ?? sn.height ?? 1) : 0,
      sShape: sn ? toEdgeNodeShape((sn.data as { style?: { type?: string } } | undefined)?.style?.type) : 'rectangle',
      sAttachedToId: sAttached,

      tExists: !!tn,
      tx: tn ? tn.position.x : 0,
      ty: tn ? tn.position.y : 0,
      tw: tn ? (tn.measured?.width ?? tn.width ?? 1) : 0,
      th: tn ? (tn.measured?.height ?? tn.height ?? 1) : 0,
      tShape: tn ? toEdgeNodeShape((tn.data as { style?: { type?: string } } | undefined)?.style?.type) : 'rectangle',
      tAttachedToId: tAttached,

      asExists: !!asn,
      asx: asn ? asn.position.x : 0,
      asy: asn ? asn.position.y : 0,
      asw: asn ? (asn.measured?.width ?? asn.width ?? 1) : 0,
      ash: asn ? (asn.measured?.height ?? asn.height ?? 1) : 0,
      asShape: asn ? toEdgeNodeShape((asn.data as { style?: { type?: string } } | undefined)?.style?.type) : 'rectangle',

      atExists: !!atn,
      atx: atn ? atn.position.x : 0,
      aty: atn ? atn.position.y : 0,
      atw: atn ? (atn.measured?.width ?? atn.width ?? 1) : 0,
      ath: atn ? (atn.measured?.height ?? atn.height ?? 1) : 0,
      atShape: atn ? toEdgeNodeShape((atn.data as { style?: { type?: string } } | undefined)?.style?.type) : 'rectangle',
    }
  }
}
