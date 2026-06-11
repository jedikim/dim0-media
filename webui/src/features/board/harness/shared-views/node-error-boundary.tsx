// Per-node error boundary used by the canvas's render-view dispatcher.
//
// Every node view is rendered inside one of these. If a node's render
// throws (bad data, broken downstream subcomponent, unhandled promise
// during commit, …) the boundary catches the error and shows a small
// inline "this node failed to render" card so the rest of the board
// keeps working. Without this, a single broken node would blank the
// entire canvas — every other node's view would be torn down too.
//
// The boundary is intentionally narrow: it doesn't try to recover
// (the only way out is for the underlying state to change and React
// to re-mount this subtree). Logging happens via a `console.error`
// so you see it in dev tools without forcing a host-app toast for
// every render hiccup.

import { Component, type ErrorInfo, type ReactNode } from "react"

import { WarningIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"


export interface NodeErrorBoundaryProps {
  /** Optional node id, included in console.error tag for grep-ability. */
  nodeId?: string
  /** Optional node type (e.g. "mini-app"), shown in the fallback UI. */
  nodeType?: string
  /** The child node view. Single child is the expected shape. */
  children: ReactNode
}


interface State {
  error: Error | null
}


export class NodeErrorBoundary extends Component<NodeErrorBoundaryProps, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const tag = this.props.nodeId
      ? `[node ${this.props.nodeType ?? "unknown"} ${this.props.nodeId}]`
      : `[node ${this.props.nodeType ?? "unknown"}]`
    console.error(`${tag} render failed:`, error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error == null) return this.props.children
    return (
      <div
        className={cn(
          "pointer-events-none relative h-full w-full select-none",
        )}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-destructive/60 bg-destructive/5 px-4 text-center">
          <WarningIcon className="size-5 shrink-0 text-destructive" />
          <span className="text-sm font-medium text-destructive">
            {this.props.nodeType
              ? `${this.props.nodeType} failed to render`
              : "Node failed to render"}
          </span>
          <span className="font-mono text-xs text-muted-foreground line-clamp-2">
            {this.state.error.message}
          </span>
        </div>
      </div>
    )
  }
}
