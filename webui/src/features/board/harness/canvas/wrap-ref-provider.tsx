import type { ReactNode } from "react"
import { HarnessWrapRefCtx, type WrapRef } from "./wrap-ref-context"


/**
 * Provider component for the canvas wrap ref. Mounted once by
 * HarnessCanvas; the context + read hook live in `wrap-ref-context.ts`
 * so fast-refresh sees this file as component-only.
 */
export const HarnessWrapRefProvider = ({
  value,
  children,
}: {
  value: WrapRef
  children: ReactNode
}) => <HarnessWrapRefCtx.Provider value={value}>{children}</HarnessWrapRefCtx.Provider>
