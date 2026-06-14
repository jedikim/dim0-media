// Force-directed layout for the `<graph>` element.
//
// Wraps d3-force so the agent can hand us a bare node/edge list and get a
// reasonable arrangement back — no hand-computed coordinates. We run the
// simulation to convergence synchronously (fixed tick count, no animation)
// and read the settled positions.
//
// Determinism matters: a widget re-render must not reshuffle the graph.
// d3-force seeds initial positions with a fixed phyllotaxis spiral and,
// since v2.1, drives its internal jiggle from a fixed-seed LCG (not
// Math.random) — so identical input yields identical output every call.

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force"
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force"


// Tuned against NODE_RADIUS (23) so spacing reads at the same scale as the
// hand-laid manual examples: links settle ~90u apart, charge keeps clusters
// from collapsing, collide guarantees circles never overlap.
const LINK_DISTANCE = 90
const CHARGE_STRENGTH = -320
const COLLIDE_RADIUS = 34
const TICKS = 300


interface SimNode extends SimulationNodeDatum {
  id: string
}


/**
 * Arrange nodes via a force-directed simulation.
 *
 * Returns a map of node id → { x, y } in viewBox units, centered on the
 * origin. Edges referencing unknown nodes are ignored for the simulation.
 */
export function forceLayout(
  nodeIds: string[],
  edges: { a: string; b: string }[],
): Map<string, { x: number; y: number }> {
  const simNodes: SimNode[] = nodeIds.map((id) => ({ id }))
  const known = new Set(nodeIds)
  const links: SimulationLinkDatum<SimNode>[] = edges
    .filter((e) => known.has(e.a) && known.has(e.b))
    .map((e) => ({ source: e.a, target: e.b }))

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id((n) => n.id)
        .distance(LINK_DISTANCE),
    )
    .force("charge", forceManyBody().strength(CHARGE_STRENGTH))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(COLLIDE_RADIUS))
    .stop()

  // Drive the simulation to a resting state in one synchronous burst.
  sim.tick(TICKS)

  const out = new Map<string, { x: number; y: number }>()
  for (const n of simNodes) {
    out.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
  }
  return out
}
