import { useEffect, useState, type RefObject } from "react"


/**
 * Returns whether the given element currently intersects the viewport.
 * Backed by IntersectionObserver, so it auto-handles pan/zoom (canvas
 * transforms still update the visual bounding rect) without coupling
 * to canvas-harness camera state. Defaults to `true` until the first
 * observation fires.
 */
export const useIsInView = (
  ref: RefObject<HTMLElement | null>,
  rootMargin = "0px",
): boolean => {
  const [inView, setInView] = useState(true)
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
