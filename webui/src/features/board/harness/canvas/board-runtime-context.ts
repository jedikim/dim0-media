import { createContext, useContext } from "react"


export type BoardRuntime = {
  local: boolean
}


export const BoardRuntimeContext = createContext<BoardRuntime>({ local: false })


/** Return whether server-backed image generation is available in this runtime. */
export const canUseServerImageGeneration = (local: boolean): boolean => !local


/** Return whether image import/search chrome may be exposed for this board role. */
export const canUseImageImports = (canEdit: boolean): boolean => canEdit


/** Read whether the current HarnessCanvas is local-only or server-synced. */
export function useBoardRuntime(): BoardRuntime {
  return useContext(BoardRuntimeContext)
}
