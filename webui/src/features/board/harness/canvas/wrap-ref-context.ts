import { createContext, useContext, type RefObject } from "react"


/**
 * Share the canvas-harness wrap div ref with chrome that needs to
 * compute screen ↔ world (e.g. the image-search dialog placing a new
 * image at the current viewport center). Mounted once by HarnessCanvas
 * so descendants don't have to prop-drill.
 *
 * Provider lives in `wrap-ref-provider.tsx`; this file holds the
 * context object + read hook so fast-refresh treats the JSX module
 * as component-only.
 */
export type WrapRef = RefObject<HTMLElement | null>


export const HarnessWrapRefCtx = createContext<WrapRef | null>(null)


/**
 * Read the canvas wrap ref. Returns `null` when called outside the
 * HarnessCanvas tree — callers should guard against that.
 */
export const useHarnessWrapRef = (): WrapRef | null => useContext(HarnessWrapRefCtx)
