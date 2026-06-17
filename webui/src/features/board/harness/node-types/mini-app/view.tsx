// On-canvas view for a mini-app note.
//
// Wraps the host-side MiniAppMount (which owns the sandboxed iframe,
// state hydration, and RPC routing) with the standard canvas chrome:
// traffic lights for delete/expand, a label caption below the card,
// off-screen suspension via useIsInView so the iframe doesn't pin the
// event loop on boards with many mini-apps.
//
// Mirrors the shape of WidgetView in node-types/widget/view.tsx — the
// canvas chrome conventions live there.

import { useCallback, useEffect, useRef } from "react"

import { CursorClickIcon } from "@phosphor-icons/react"
import { type NodeId } from "@canvas-harness/core"
import { useCanvasStore, useNode, useSelection } from "@canvas-harness/react"

import { MiniAppMount } from "@/features/mini-app"
import { cn } from "@/lib/utils"

import type { NoteNodeData } from "../../convert/note-to-node"
import {
  NodeTitleCaption,
  NodeTrafficLights,
  useIsInView,
} from "../../shared-views"
import { useBoardAppStore } from "../../store/board-app-store"


// Card chrome (padding + traffic-lights row + title slot). Subtracted
// from the canvas node's reported `h` to derive the inner iframe slot
// height, and added back when computing the node's target height from
// the widget's natural content height.
const CARD_CHROME_PX = 48

// Hard cap on automatic growth — past this, the widget gets a
// scrollbar inside the iframe slot instead of pushing the canvas
// node taller. Stops a runaway widget from monopolizing the board.
const MAX_AUTO_GROW_PX = 1200


export interface MiniAppViewProps {
  id: NodeId
}


/**
 * Canvas view for a mini-app note. Renders the iframe via MiniAppMount
 * when the node is in view; otherwise shows a paused-state placeholder
 * card so the rest of the board stays responsive.
 */
export function MiniAppView({ id }: MiniAppViewProps) {
  const node = useNode(id)
  const store = useCanvasStore()
  const openNodeSurface = useBoardAppStore((s) => s.openNodeSurface)
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const wrapRef = useRef<HTMLDivElement>(null)
  const isInView = useIsInView(wrapRef, "200px")
  // Gate iframe interaction on selection so canvas pan/zoom gestures
  // pass cleanly through unselected mini-apps. Without this, the
  // iframe's `pointer-events-auto` captures the pointer the moment
  // the user's drag crosses into the card → canvas-harness loses
  // gesture tracking → pan dies mid-swipe. Same pattern sheet uses for
  // its inline editor (gated on `editing` instead of selection).
  const selection = useSelection()
  const isSelected = selection.includes(id)

  // rAF-throttled grow-only resize. The widget posts `mini-app:resize`
  // through MiniAppMount on every content-size change; we batch those
  // into at most one node-resize per animation frame and only ever
  // grow the card (the user is free to shrink it manually via the
  // canvas resize handles afterward). `lastAppliedH` deduplicates
  // identical heights so an idle widget reporting the same number
  // doesn't trigger redundant store writes.
  const pendingHeightRef = useRef<number | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const lastAppliedHRef = useRef<number>(0)
  const onContentHeightChange = useCallback(
    (widgetH: number) => {
      pendingHeightRef.current = widgetH
      if (rafIdRef.current != null) return
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        const pending = pendingHeightRef.current
        pendingHeightRef.current = null
        if (pending == null) return
        const target = Math.min(pending + CARD_CHROME_PX, MAX_AUTO_GROW_PX)
        const current = store.getNode(id)?.h ?? 0
        // Grow only, and only by a meaningful delta (avoid storms from
        // sub-pixel oscillation).
        if (target <= current + 1) return
        if (target === lastAppliedHRef.current) return
        lastAppliedHRef.current = target
        store.updateNode(id, { h: target })
      })
    },
    [id, store],
  )

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  if (!node) return null

  const data = (node.data ?? {}) as Partial<NoteNodeData>
  const label = data.label?.markdown
  const source = node.content ?? ""

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none relative h-full w-full select-none"
    >
      <div
        className={cn(
          "absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-dashed border-border bg-background px-2 pb-2 pt-10",
        )}
      >
        <div className="relative h-full w-full overflow-hidden rounded-xl border border-border/50 bg-background">
          {source && isInView ? (
            <MiniAppMount
              noteId={id as unknown as string}
              source={source}
              className={cn(
                "h-full w-full bg-transparent",
                isSelected ? "pointer-events-auto" : "pointer-events-none",
              )}
              onContentHeightChange={onContentHeightChange}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
              <CursorClickIcon className="size-5 shrink-0" />
              <span>{source ? "Mini-app paused" : "Mini-app source will render here"}</span>
            </div>
          )}
        </div>
      </div>

      <NodeTrafficLights
        onDelete={canEdit ? () => store.removeNode(id) : undefined}
        onExpand={canEdit ? () => openNodeSurface(id as unknown as string, "mini-app") : undefined}
      />

      <div className="pointer-events-auto absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2">
        <NodeTitleCaption
          nodeId={id}
          label={label}
          placeholder="Untitled mini-app"
          textClassName="text-center text-sm font-handwriting text-foreground"
        />
      </div>
    </div>
  )
}
