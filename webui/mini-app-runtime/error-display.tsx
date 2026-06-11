// Two error cards shown inside the iframe when a mini-app fails to
// compile or fails at render time. Visually distinct enough that an
// agent (or a human eyeballing the iframe) can tell what stage broke.
//
// Styling uses host theme tokens (--destructive, --muted-foreground)
// via Tailwind utility classes that ship in the runtime CSS bundle.

import type { CompileError } from "./compile"


export function CompileErrorCard({ error }: { error: CompileError }) {
  return (
    <div className="m-4 rounded-md border border-destructive bg-destructive/5 p-4 font-mono text-sm">
      <div className="mb-2 font-semibold text-destructive">
        Mini-app compile error
      </div>
      <div className="whitespace-pre-wrap text-xs">{error.message}</div>
      {error.line != null && (
        <div className="mt-2 text-xs text-muted-foreground">
          at line {error.line}
          {error.column != null ? `, column ${error.column}` : ""}
        </div>
      )}
    </div>
  )
}


export function RuntimeErrorCard({ error }: { error: Error }) {
  return (
    <div className="m-4 rounded-md border border-destructive bg-destructive/5 p-4 font-mono text-sm">
      <div className="mb-2 font-semibold text-destructive">
        Mini-app runtime error
      </div>
      <div className="whitespace-pre-wrap text-xs">{error.message}</div>
    </div>
  )
}
