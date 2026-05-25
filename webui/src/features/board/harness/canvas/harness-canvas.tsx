import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { hitTestAny, type CanvasStore, type Renderer } from "@canvas-harness/core"
import { setAgentBridge } from "../agent/agent-bridge"
import { applyLinkOutput, applyNoteOutput } from "../agent/apply-tool-output"
import { useHarnessApplyMindMap } from "../agent/use-harness-apply-mindmap"
import { setCanvasStoreRef } from "../canvas-store-ref"
import {
  Canvas,
  CanvasProvider,
  Minimap,
  type ArrowToolDefaults,
  type CanvasPointerEvent,
} from "@canvas-harness/react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  CanvasContextMenu,
  HarnessSaveStatus,
  HarnessToolbar,
  HarnessViewportControls,
  NodeSurfaceHost,
  PresentationControls,
  SlidesPanel,
  StyleSidebar,
} from "../chrome"
import { LinearView, ListView } from "../views"
import { boardNodeTypes, useRenderCustomNodeView } from "../node-types"
import { hydrateBoardStore } from "../persist/snapshot-load"
import { useBoardDebouncedSave, type SaveStatus } from "../persist/use-debounced-save"
import { useBoardAppStore } from "../store/board-app-store"
import { createBoardStore } from "../store/create-board-store"
import { useBoardTheme } from "../theme/use-board-theme"
import { useThemeColorProjection } from "../theme/use-theme-color-projection"
import { useBoardKeyboard } from "./use-board-keyboard"
import { useCenterFromUrl } from "./use-center-from-url"
import { useCreateHandlers } from "./use-create-handlers"
import { useHarnessDropFiles } from "./use-drop-files"
import { useHydrateIconNodes } from "./use-hydrate-icon-nodes"
import { usePresentationMode } from "./use-presentation-mode"
import { useStampNewEdges } from "./use-stamp-new-edges"
import { useStyleMemory } from "./use-style-memory"
import { useThumbnailCapture } from "./use-thumbnail-capture"
import { useViewportPersistence } from "./use-viewport-persistence"
import { HarnessWrapRefProvider } from "./wrap-ref-provider"


/**
 * Canvas-harness mount for the Dim0 board. One per board view; the
 * canvas-harness store is created lazily and persists across re-renders
 * for the same component instance.
 *
 * Responsibilities:
 *  - Create the canvas store with the custom node-type registry
 *  - Hydrate from the board API on scope change (board-app-store boardId/rootId)
 *  - Subscribe the debounced save once hydration completes
 *  - Wire theme + selection chrome + minimap from useBoardTheme
 *  - Dispatch custom node views via the central router
 *
 * Tool state, top-bar wiring, keyboard shortcuts land in subsequent
 * phase-4 commits.
 */
export function HarnessCanvas() {
  const boardId = useBoardAppStore((s) => s.boardId)
  const rootId = useBoardAppStore((s) => s.rootId)
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const setIsLoading = useBoardAppStore((s) => s.setIsLoading)
  const setCanEdit = useBoardAppStore((s) => s.setCanEdit)
  const setBoardLabel = useBoardAppStore((s) => s.setBoardLabel)
  const setBoardVisibility = useBoardAppStore((s) => s.setBoardVisibility)

  const storeRef = useRef<CanvasStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createBoardStore({ nodeTypes: [...boardNodeTypes] })
  }
  const store = storeRef.current

  const tool = useBoardAppStore((s) => s.tool)
  const viewMode = useBoardAppStore((s) => s.viewMode)
  const theme = useBoardTheme()
  const [ready, setReady] = useState(false)
  const saveStatus = useBoardDebouncedSave(store, boardId, ready)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Captured via `<Canvas onRenderer>`; presentation mode toggles
  // `setHideFrames` on this so slide chrome (border + label) drops out
  // and only the contents show.
  const rendererRef = useRef<Renderer | null>(null)
  const queryClient = useQueryClient()

  // Bridge for the agent's post-stream apply block (lives outside this
  // component tree). Closures capture the current store + scope so the
  // applier doesn't need access to React state. Cleared on unmount /
  // scope change.
  useEffect(() => {
    if (!boardId) {
      setAgentBridge(null)
      return
    }
    setAgentBridge({
      applyNoteOutput: (output) =>
        applyNoteOutput(store, queryClient, boardId, rootId, output),
      applyLinkOutput: (output) =>
        applyLinkOutput(store, boardId, output),
    })
    return () => setAgentBridge(null)
  }, [store, queryClient, boardId, rootId])

  // Module-level store ref — lets non-React code (buildMessageContext,
  // other agent helpers) reach the active store without prop-drilling.
  useEffect(() => {
    setCanvasStoreRef(store)
    return () => setCanvasStoreRef(null)
  }, [store])

  useBoardKeyboard(store)
  useViewportPersistence(store, boardId, rootId, ready)
  useCenterFromUrl(store, wrapRef, ready)
  useStampNewEdges(store, boardId, rootId)
  useHarnessApplyMindMap(store, boardId, rootId)
  useHydrateIconNodes(store, boardId, rootId, ready)
  useThemeColorProjection(store, ready)
  useThumbnailCapture(store, boardId, ready, theme.minimap)
  usePresentationMode(store, wrapRef, rendererRef)

  const styleMemory = useStyleMemory(store)
  const { handleCreateDrag, handleClick } = useCreateHandlers(store, boardId, rootId, styleMemory)
  const arrowDefaults = useMemo<ArrowToolDefaults>(
    () => ({
      pathStyle: styleMemory.getEdgePathStyle(),
      style: styleMemory.getEdgeStyle(),
    }),
    [styleMemory],
  )
  const { onDragOver, onDrop } = useHarnessDropFiles(wrapRef, store, boardId, rootId, canEdit)
  const navigate = useNavigate()

  // canvas-harness fires beginEdit on dbl-click of any node body. For
  // custom node types we own the editing surface (sheet/code-sandbox/
  // widget open via the panel; folder dbl-click navigates into the
  // folder; document has no inline editor), so cancel the auto-fired
  // beginEdit. Lib fires beginEdit BEFORE the consumer onDoubleClick,
  // so cancel here runs synchronously in the same tick — no editor
  // frame is rendered.
  const handleDoubleClick = useCallback(
    (e: CanvasPointerEvent): void => {
      const camera = store.getCamera()
      const hit = hitTestAny(store, e.world, camera.z)
      if (!hit || !("nodeId" in hit)) return
      const node = store.getNode(hit.nodeId)
      if (!node) return
      if (!CUSTOM_NODE_TYPES.has(node.type)) return
      store.cancelEdit()
      if (node.type === "folder" && boardId) {
        navigate({
          to: "/boards/$id",
          params: { id: boardId },
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            root_id: node.id,
          }),
        })
      }
    },
    [store, boardId, navigate],
  )

  // Hydrate on scope change. `cancelled` guards against late-arriving fetches
  // when the user navigates rapidly between boards.
  useEffect(() => {
    if (!boardId) {
      setReady(false)
      return
    }
    let cancelled = false
    setReady(false)
    setIsLoading(true)
    hydrateBoardStore(store, { boardId, rootId: rootId ?? undefined })
      .then(({ graph, canEdit }) => {
        if (cancelled) return
        setCanEdit(canEdit)
        setBoardLabel(graph.label ?? "")
        if (graph.visibility === "private" || graph.visibility === "public") {
          setBoardVisibility(graph.visibility)
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("[harness] hydrate failed", err)
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [boardId, rootId, store, setIsLoading, setCanEdit, setBoardLabel, setBoardVisibility])

  return (
    <CanvasProvider store={store}>
      <HarnessWrapRefProvider value={wrapRef}>
        <div
          ref={wrapRef}
          className="absolute inset-0"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <HarnessCanvasInner
            theme={theme}
            tool={tool}
            viewMode={viewMode}
            saveStatus={saveStatus}
            arrowDefaults={arrowDefaults}
            onCreateDrag={handleCreateDrag}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onRenderer={(r) => {
              rendererRef.current = r
            }}
          />
          <CanvasContextMenu wrapRef={wrapRef} store={store} />
        </div>
      </HarnessWrapRefProvider>
    </CanvasProvider>
  )
}


/** canvas node.type values whose dbl-click should NOT trigger the lib's beginEdit. */
const CUSTOM_NODE_TYPES = new Set([
  "folder",
  "document",
  "sheet",
  "code-sandbox",
  "widget",
])


type InnerProps = {
  theme: ReturnType<typeof useBoardTheme>
  tool: string
  viewMode: "board" | "files" | "list"
  saveStatus: SaveStatus
  arrowDefaults: ArrowToolDefaults
  onCreateDrag: ReturnType<typeof useCreateHandlers>["handleCreateDrag"]
  onClick: ReturnType<typeof useCreateHandlers>["handleClick"]
  onDoubleClick: (e: CanvasPointerEvent) => void
  onRenderer: (r: Renderer) => void
}


function HarnessCanvasInner({
  theme,
  tool,
  viewMode,
  saveStatus,
  arrowDefaults,
  onCreateDrag,
  onClick,
  onDoubleClick,
  onRenderer,
}: InnerProps) {
  const renderView = useRenderCustomNodeView()
  const isBoard = viewMode === "board"
  return (
    <>
      {isBoard ? (
        <>
          <Canvas
            tool={tool}
            theme={theme.resolver}
            selectionColor={theme.selectionColor}
            background={theme.background}
            renderCustomNodeView={renderView}
            arrowDefaults={arrowDefaults}
            onCreateDrag={onCreateDrag}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onRenderer={onRenderer}
          />
          <Minimap
            width={200}
            height={140}
            viewportColor={theme.minimap.viewportColor}
            backgroundColor={theme.minimap.backgroundColor}
            borderColor={theme.minimap.borderColor}
            defaultNodeColor={theme.minimap.defaultNodeColor}
            style={{
              position: "absolute",
              bottom: 16,
              right: 16,
              borderRadius: 6,
              overflow: "hidden",
              zIndex: 50,
            }}
          />
          <HarnessViewportControls />
          <StyleSidebar />
        </>
      ) : viewMode === "files" ? (
        <LinearView />
      ) : (
        <ListView />
      )}
      {/*
        Always-mounted chrome: toolbar (with view dropdown), save
        status badge, slide-related surfaces. NodeSurfaceHost stays
        mounted everywhere so the modal editor opens from any view.
      */}
      <HarnessToolbar />
      <HarnessSaveStatus status={saveStatus} />
      <NodeSurfaceHost />
      <SlidesSheet />
      <PresentationOverlay />
    </>
  )
}


/**
 * Right-side Sheet hosting the slides panel. Open state lives on the
 * app store so the toolbar button + keyboard shortcut can toggle it.
 * `modal={false}` + no overlay keeps the canvas interactive while the
 * panel is up (you can still pan / pick a slide on the canvas).
 */
function SlidesSheet() {
  const open = useBoardAppStore((s) => s.slidesPanelOpen)
  const setOpen = useBoardAppStore((s) => s.setSlidesPanelOpen)
  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetContent
        side="right"
        showOverlay={false}
        showClose={false}
        className="w-[360px] max-w-[92vw] border-l border-border bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Slides</SheetTitle>
        </SheetHeader>
        <SlidesPanel />
      </SheetContent>
    </Sheet>
  )
}


/** Floating bottom-center controls, only mounted while presenting. */
function PresentationOverlay() {
  const presenting = useBoardAppStore((s) => s.presentationMode)
  if (!presenting) return null
  return <PresentationControls />
}
