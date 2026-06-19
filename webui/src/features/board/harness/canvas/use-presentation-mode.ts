import { useEffect, useRef } from "react"
import type { CameraState, CanvasStore, NodeId, Renderer } from "@canvas-harness/core"
import { isTypingTarget } from "@/lib/dom/is-typing-target"
import { useBoardAppStore } from "../store/board-app-store"
import { fitCameraToNode } from "./use-fit-camera-to-node"


/**
 * Wires presentation-mode behavior:
 *   - On enter: snapshot the pre-presentation camera, hide frame
 *     chrome (lib's `Renderer.setHideFrames`), then fit the camera to
 *     the active slide (or the first frame). The hide is done one
 *     frame BEFORE the camera moves so there's no chrome flash —
 *     matches the playground example.
 *   - While active: ← / → step through frames, Esc exits.
 *   - On exit: restore frame chrome + the snapshotted camera.
 */
export const usePresentationMode = (
  store: CanvasStore,
  wrapRef: React.RefObject<HTMLElement | null>,
  rendererRef: React.RefObject<Renderer | null>,
): void => {
  const presentationMode = useBoardAppStore((s) => s.presentationMode)
  const activeSlideId = useBoardAppStore((s) => s.activeSlideId)
  const setActiveSlideId = useBoardAppStore((s) => s.setActiveSlideId)
  const setPresentationMode = useBoardAppStore((s) => s.setPresentationMode)
  const savedCameraRef = useRef<CameraState | null>(null)

  // Camera + chrome lifecycle — hide chrome and fit on enter, restore
  // chrome + camera on exit.
  useEffect(() => {
    if (!presentationMode) {
      rendererRef.current?.setHideFrames(false)
      const saved = savedCameraRef.current
      if (saved) {
        store.setCamera(saved)
        savedCameraRef.current = null
      }
      return
    }
    // Snapshot once per enter (don't overwrite while already presenting).
    if (savedCameraRef.current === null) {
      savedCameraRef.current = store.getCamera()
    }
    const frames = store.getFrames()
    if (frames.length === 0) return
    const target =
      (activeSlideId
        ? frames.find((f) => (f.id as unknown as string) === activeSlideId)
        : undefined) ?? frames[0]

    // Drop chrome first; wait one frame so the renderer paints once
    // without it before we move the camera. Avoids a one-frame flash
    // of the frame border / label at the new zoom.
    rendererRef.current?.setHideFrames(true)
    // Clear selection so the selection overlay (box + handles) doesn't
    // keep painting over the slide — setHideFrames only drops frame
    // chrome, not selection chrome.
    store.setSelection([])
    const raf = window.requestAnimationFrame(() => {
      fitCameraToNode(store, wrapRef.current, target)
    })

    if ((target.id as unknown as string) !== activeSlideId) {
      setActiveSlideId(target.id as unknown as string)
    }

    return () => window.cancelAnimationFrame(raf)
  }, [presentationMode, activeSlideId, store, wrapRef, rendererRef, setActiveSlideId])

  // Keyboard nav — only bound while presenting.
  useEffect(() => {
    if (!presentationMode) return
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const frames = store.getFrames()
      const ids = frames.map((f) => f.id as unknown as string)
      const i = activeSlideId ? ids.indexOf(activeSlideId) : -1

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault()
        const delta = e.key === "ArrowLeft" ? -1 : 1
        const next = i < 0 ? 0 : i + delta
        if (next < 0 || next >= frames.length) return
        const target = frames[next]
        setActiveSlideId(target.id as unknown as string)
        fitCameraToNode(store, wrapRef.current, target)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setPresentationMode(false)
        setActiveSlideId(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [presentationMode, activeSlideId, store, wrapRef, setActiveSlideId, setPresentationMode])
}


/**
 * Snap to a frame by id without entering presentation mode — used by
 * the slides panel row-click handler. Sets the active slide id so the
 * panel can highlight the row.
 */
export const previewSlide = (
  store: CanvasStore,
  wrap: HTMLElement | null,
  id: NodeId,
): boolean => {
  const node = store.getNode(id)
  if (!node) return false
  return fitCameraToNode(store, wrap, node)
}
