import { transform } from "sucrase"


export type MiniAppValidation = { ok: true } | { ok: false; message: string; line?: number; column?: number }


/** Pull a `(line:col)` position out of a sucrase error message, if present. */
const parseError = (err: unknown): { message: string; line?: number; column?: number } => {
  const message = err instanceof Error ? err.message : String(err)
  const m = /\((\d+):(\d+)\)/.exec(message)
  return m ? { message, line: Number(m[1]), column: Number(m[2]) } : { message }
}


/**
 * Write-time validation of a mini-app source: sucrase transpile (catches syntax
 * errors with line/col) + a check that a `Widget`/`App` component is declared.
 * Mirrors the backend compile.py validation; does NOT evaluate (no scope, no
 * side effects) — the iframe runtime does the full compile + render. Lets the
 * agent self-correct a malformed mini-app in the same turn instead of writing a
 * note that silently fails to render.
 */
export const validateMiniAppSource = (source: string): MiniAppValidation => {
  try {
    transform(source, { transforms: ["jsx", "typescript"], jsxRuntime: "classic", production: true })
  } catch (err) {
    return { ok: false, ...parseError(err) }
  }
  if (!/\b(?:function|const|let|var|class)\s+(?:Widget|App)\b/.test(source)) {
    return {
      ok: false,
      message:
        "no Widget or App component found — define `function Widget() { … }` (or `const Widget = () => …`) at the top level",
    }
  }
  return { ok: true }
}
