import type { ReactNode } from "react"

import { BoardRuntimeContext } from "./board-runtime-context"


/** Provide the existing HarnessCanvas runtime mode to custom node views. */
export function BoardRuntimeProvider({
  local,
  children,
}: {
  local: boolean
  children: ReactNode
}) {
  return (
    <BoardRuntimeContext.Provider value={{ local }}>
      {children}
    </BoardRuntimeContext.Provider>
  )
}
