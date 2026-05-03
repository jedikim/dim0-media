interface Props {
  /** How many ancestors the current sheet has (0 for top-level). */
  depth: number
}


/** Visual cap — beyond this the breadcrumb already conveys "deep". */
const MAX_LAYERS = 3


/**
 * Renders ghost card layers behind the active sheet dialog so the user can
 * tell at a glance how deep they are in the page hierarchy. The deepest
 * layer sits furthest behind, lightly rotated and offset, matching a
 * stack-of-papers metaphor.
 *
 * Expected to be placed inside a `position: relative` ancestor with
 * `overflow: visible` so the offset peek-out is visible.
 */
export function SheetStackBackground({ depth }: Props) {
  if (depth <= 0) return null
  const layers = Math.min(depth, MAX_LAYERS)
  return (
    <>
      {Array.from({ length: layers }).map((_, i) => {
        // Layer 0 sits closest behind the foreground; deeper layers fan
        // out further. The closest ghost is kept straight (only a tiny
        // offset peek-out) so the foreground silhouette always reads as
        // square — the rotation pattern only kicks in at depth ≥ 2.
        const order = i + 1
        let transform = ""
        if (i === 0) {
          transform = "translate(4px, 4px)"
        } else {
          const sign = i % 2 === 1 ? 1 : -1
          const rotation = sign * (1 + Math.floor((i - 1) / 2)) * 1.5
          transform = `rotate(${rotation}deg)`
        }
        return (
          <div
            key={i}
            aria-hidden
            className="sheet-stack-layer"
            style={{ transform, zIndex: -order }}
          />
        )
      })}
    </>
  )
}
