import { useEffect } from 'react'


const CULLED_CLASS = 'graph-node-culled'
const ROOT_MARGIN = '200px'


/**
 * Browser-driven viewport cull for graph nodes. Adds .graph-node-culled to
 * .react-flow__node elements that fall outside the renderer viewport (with
 * a generous rootMargin buffer); the class applies content-visibility:
 * hidden so the browser skips paint and layout for those nodes while they
 * remain mounted in the React tree.
 *
 * On-screen and near-viewport nodes carry no class and no containment, so
 * rough.js stroke bleed and overflowing decorations (captions, titles,
 * drag handles, layered shape offsets) render without clipping.
 *
 * IntersectionObserver toggles the class as the viewport pans/zooms. A
 * MutationObserver keeps the IO's observed set in sync with React Flow's
 * additions and removals of node elements, so newly-created nodes are
 * watched automatically and removed nodes are unobserved cleanly.
 */
export function useNodeViewportCull(): void {
  useEffect(() => {
    const renderer = document.querySelector('.react-flow__renderer') as HTMLElement | null
    if (!renderer) return
    const nodesContainer = (renderer.querySelector('.react-flow__nodes') as HTMLElement | null) ?? renderer

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle(CULLED_CLASS, !entry.isIntersecting)
        }
      },
      {
        root: renderer,
        rootMargin: ROOT_MARGIN,
        threshold: 0,
      },
    )

    nodesContainer
      .querySelectorAll('.react-flow__node')
      .forEach((node) => intersectionObserver.observe(node))

    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains('react-flow__node')) {
            intersectionObserver.observe(node)
          }
        })
        mutation.removedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains('react-flow__node')) {
            intersectionObserver.unobserve(node)
          }
        })
      }
    })
    mutationObserver.observe(nodesContainer, { childList: true })

    return () => {
      intersectionObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [])
}
