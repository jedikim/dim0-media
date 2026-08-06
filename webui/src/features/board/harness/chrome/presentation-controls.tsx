import { useCallback, useEffect, useState } from "react"
import type { CanvasStore, NodeId } from "@canvas-harness/core"
import { useCanvasStore } from "@canvas-harness/react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  StopPresentationIcon,
} from "@/components/icons"
import { Button } from "@/components/ui/button"
import { useHarnessWrapRef } from "../canvas/wrap-ref-context"
import { previewSlide } from "../canvas/use-presentation-mode"
import { useBoardAppStore } from "../store/board-app-store"


/**
 * Floating bottom-center bar shown only in presentation mode: prev /
 * next / stop. Prev + next derive from the lib's frame order; stop
 * exits presentation mode (which triggers the camera restore in
 * `usePresentationMode`).
 */
export function PresentationControls() {
  const store = useCanvasStore()
  const wrapRef = useHarnessWrapRef()
  const activeSlideId = useBoardAppStore((s) => s.activeSlideId)
  const setActiveSlideId = useBoardAppStore((s) => s.setActiveSlideId)
  const setPresentationMode = useBoardAppStore((s) => s.setPresentationMode)

  const frameIds = useFrameIds(store)
  const i = activeSlideId ? frameIds.indexOf(activeSlideId) : -1
  const canPrev = i > 0
  const canNext = i >= 0 && i < frameIds.length - 1

  const go = useCallback(
    (delta: -1 | 1) => {
      const next = i + delta
      const target = frameIds[next]
      if (!target) return
      setActiveSlideId(target)
      previewSlide(store, wrapRef?.current ?? null, target as NodeId)
    },
    [i, frameIds, store, wrapRef, setActiveSlideId],
  )

  const handleStop = useCallback(() => {
    setPresentationMode(false)
    setActiveSlideId(null)
  }, [setPresentationMode, setActiveSlideId])

  return (
    <div
      role="toolbar"
      aria-label="Presentation controls"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-sidebar/90 px-3 py-2 shadow-lg backdrop-blur-md [.tauri-webkit_&]:backdrop-blur-none"
    >
      <Button
        size="icon"
        variant="ghost"
        disabled={!canPrev}
        onClick={() => go(-1)}
        title="Previous slide"
        aria-label="Previous slide"
      >
        <ChevronLeftIcon className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={!canNext}
        onClick={() => go(1)}
        title="Next slide"
        aria-label="Next slide"
      >
        <ChevronRightIcon className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="destructive"
        onClick={handleStop}
        title="Stop presenting"
        aria-label="Stop presenting"
      >
        <StopPresentationIcon className="size-4" />
      </Button>
    </div>
  )
}


/**
 * Subscribe to the lib's frame list as a string-id array. Mirrors the
 * `useFrames` pattern in `slides-panel.tsx` — `useSyncExternalStore`
 * would loop because `getFrames()` returns a fresh array each call.
 */
const useFrameIds = (store: CanvasStore): string[] => {
  const read = (): string[] =>
    store.getFrames().map((f) => f.id as unknown as string)
  const [ids, setIds] = useState<string[]>(read)
  useEffect(() => {
    setIds(read())
    return store.subscribe("change", () => setIds(read()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])
  return ids
}
