// Hierarchical (top-down tree) layout for the `<graph>` element.
//
// Reads the edge list as parent → child (edge.a is the parent) and runs
// d3-hierarchy's tidy-tree algorithm. The graph need not be a strict tree:
// we derive a spanning hierarchy by BFS from the root and treat any extra
// edges as cross-links — they're still rendered, just not used to place
// nodes. Cycles are broken by visiting each node at most once.

import { hierarchy, tree } from "d3-hierarchy"


// Sibling separation (x) and depth separation (y), in viewBox units.
// Sized so a labelled circle (radius 23) clears its neighbours.
const SIBLING_GAP = 70
const DEPTH_GAP = 90


interface TreeDatum {
  id: string
  children: TreeDatum[]
}


/**
 * Arrange nodes as a top-down hierarchy.
 *
 * Root is `explicitRoot` when valid, else the first node with no incoming
 * edge, else the first node. Nodes unreachable from the root (disconnected
 * components) are stacked in a row beneath the tree so nothing is lost.
 */
export function treeLayout(
  nodeIds: string[],
  edges: { a: string; b: string }[],
  explicitRoot?: string,
): Map<string, { x: number; y: number }> {
  const known = new Set(nodeIds)
  const parentOf = new Map<string, string>()
  const childrenOf = new Map<string, string[]>()
  for (const e of edges) {
    if (!known.has(e.a) || !known.has(e.b)) continue
    // First incoming edge wins; later ones are cross-links, not tree edges.
    if (parentOf.has(e.b) || e.a === e.b) continue
    parentOf.set(e.b, e.a)
    const siblings = childrenOf.get(e.a) ?? []
    siblings.push(e.b)
    childrenOf.set(e.a, siblings)
  }

  const root =
    (explicitRoot && known.has(explicitRoot) ? explicitRoot : undefined) ??
    nodeIds.find((id) => !parentOf.has(id)) ??
    nodeIds[0]

  const out = new Map<string, { x: number; y: number }>()
  if (root == null) return out

  // BFS-build the spanning hierarchy, guarding against cycles.
  const seen = new Set<string>()
  const build = (id: string): TreeDatum => {
    seen.add(id)
    const kids = (childrenOf.get(id) ?? []).filter((c) => !seen.has(c))
    return { id, children: kids.map(build) }
  }
  const rootDatum = build(root)

  const laidOut = tree<TreeDatum>().nodeSize([SIBLING_GAP, DEPTH_GAP])(
    hierarchy(rootDatum),
  )
  laidOut.each((d) => {
    out.set(d.data.id, { x: d.x, y: d.y })
  })

  // Place any nodes the root couldn't reach in a row below the tree, so
  // disconnected pieces stay visible and predictable.
  let maxY = 0
  for (const { y } of out.values()) maxY = Math.max(maxY, y)
  let col = 0
  for (const id of nodeIds) {
    if (out.has(id)) continue
    out.set(id, { x: col * SIBLING_GAP, y: maxY + DEPTH_GAP })
    col += 1
  }
  return out
}
