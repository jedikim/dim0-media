import { useEffect, type RefObject } from "react"


/**
 * Attach a native `pointerdown` listener that stops propagation. Used
 * on interactive elements (buttons, inputs) that sit INSIDE a node's
 * bounding box — without this, canvas-harness's gesture hook captures
 * the pointer on body-hit (see use-interaction-gesture.ts:319-347) and
 * the click event never fires on the element.
 *
 * Must be a native listener via ref: React's `onPointerDown` runs at
 * the React root level (event delegation), which is ABOVE the
 * canvas-harness wrap div in the DOM, so by the time React's handler
 * fires the wrap's native listener has already captured the pointer.
 */
export const useStopCanvasGesture = (
  ref: RefObject<HTMLElement | null>,
): void => {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const stop = (e: PointerEvent): void => e.stopPropagation()
    el.addEventListener("pointerdown", stop)
    return () => el.removeEventListener("pointerdown", stop)
  }, [ref])
}
