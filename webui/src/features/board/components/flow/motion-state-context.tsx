import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useGraphStore } from '../../store/graph-store'


type MotionState = {
  isMoving: boolean
  isResizingNode: boolean
}


const DEFAULT_MOTION: MotionState = { isMoving: false, isResizingNode: false }

const MotionContext = createContext<MotionState>(DEFAULT_MOTION)
const ZoomContext = createContext<number>(1)


/**
 * Buckets viewport zoom to tenths so consumers re-render only when the
 * value crosses a quantized step. Centralized here so each rendered shape
 * doesn't need to maintain its own copy.
 */
function quantizeZoom(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.1, Math.round(value * 10) / 10)
}


type ProviderProps = { children: ReactNode }


/**
 * Subscribes once to motion flags (isMoving, isResizingNode) and exposes
 * them via context so descendant shapes can replace three
 * useSyncExternalStore subscriptions per mount with one useContext read.
 * Splitting motion and zoom into separate contexts is intentional — a
 * combined context would force every consumer to re-render on every zoom
 * commit.
 */
export function MotionProvider({ children }: ProviderProps) {
  const isMoving = useGraphStore(state => state.isMoving)
  const isResizingNode = useGraphStore(state => state.isResizingNode)
  const value = useMemo(
    () => ({ isMoving, isResizingNode }),
    [isMoving, isResizingNode],
  )
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>
}


/**
 * Subscribes once to viewport zoom (quantized) so every shape sees the
 * same bucketed value. Re-renders consumers only when the bucket changes.
 */
export function ZoomProvider({ children }: ProviderProps) {
  const effectiveZoom = useGraphStore(state => quantizeZoom(state.zoom ?? 1))
  return <ZoomContext.Provider value={effectiveZoom}>{children}</ZoomContext.Provider>
}


// eslint-disable-next-line react-refresh/only-export-components
export const useMotionState = (): MotionState => useContext(MotionContext)


// eslint-disable-next-line react-refresh/only-export-components
export const useEffectiveZoom = (): number => useContext(ZoomContext)
