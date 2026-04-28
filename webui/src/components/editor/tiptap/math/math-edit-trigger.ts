/**
 * Imperative trigger for the floating math editor. Lives in its own module so
 * the popover component file can keep a components-only export shape (required
 * for React Fast Refresh).
 */


export type MathEditOpts = {
  pos: number
  latex: string
  isInline: boolean
}


let openFn: ((opts: MathEditOpts) => void) | null = null


/** Trigger the floating math editor for the math node at `pos`. */
export const openMathEditor = (opts: MathEditOpts): void => {
  openFn?.(opts)
}


/** Internal: registers the popover's open handler. Returns an unsubscribe. */
export const registerMathEditorOpener = (handler: (opts: MathEditOpts) => void): () => void => {
  openFn = handler
  return () => {
    if (openFn === handler) openFn = null
  }
}
