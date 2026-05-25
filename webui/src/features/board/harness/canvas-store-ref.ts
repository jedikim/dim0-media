import type { CanvasStore } from "@canvas-harness/core"


/**
 * Module-level reference to the active canvas-harness store. Mirrors
 * the `setBoardNavigate` / `setNodeSurfaceNavigator` / `setAgentBridge`
 * pattern so code that runs outside the React canvas tree (the agent's
 * `buildMessageContext`, the toolbar's chat shortcuts, etc.) can reach
 * the live store without importing the component.
 *
 * `HarnessCanvas` registers the store in a `useEffect` on mount and
 * clears it on unmount / scope change. Only one board is ever active
 * at a time so a single slot suffices.
 *
 * Callers must handle the `null` case — e.g. when nothing is mounted
 * (login screen, dashboard) the bridge returns `null` and the caller
 * should no-op gracefully.
 */
let _store: CanvasStore | null = null


export const setCanvasStoreRef = (store: CanvasStore | null): void => {
  _store = store
}


export const getCanvasStoreRef = (): CanvasStore | null => _store
