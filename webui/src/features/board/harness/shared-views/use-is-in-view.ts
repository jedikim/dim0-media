import { useEffect, useState, type RefObject } from "react"


/**
 * Returns whether the given element currently intersects the viewport.
 * Backed by IntersectionObserver, so it auto-handles pan/zoom (canvas
 * transforms still update the visual bounding rect) without coupling
 * to canvas-harness camera state.
 *
 * `initialInView` is the value returned until the first observation fires
 * (default `true`). Pass `false` when a false→true correction is cheaper than
 * a true→false one — e.g. to avoid mounting every node on initial load before
 * the observer reports which are actually visible.
 */
export const useIsInView = (
  ref: RefObject<HTMLElement | null>,
  rootMargin = "0px",
  initialInView = true,
): boolean => {
  const [inView, setInView] = useState(initialInView)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const obs = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0, rootMargin },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref, rootMargin])
  return inView
}
