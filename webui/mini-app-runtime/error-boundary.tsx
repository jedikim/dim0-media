// React error boundary for the agent-authored Widget.
//
// Runtime errors thrown during render bubble up to here; we render the
// `fallback` instead of tearing down the iframe root. The compile pipeline
// only catches errors thrown during top-level body evaluation — once
// `compileMiniApp` returns ok, any subsequent throw from inside the
// Widget's render happens during React's render phase and is the
// boundary's job to handle.
//
// Class component is the only way React supports error boundaries
// (no hook equivalent as of React 19). One of the very few places in
// this codebase that uses class syntax.

import { Component, type ErrorInfo, type ReactNode } from "react"


interface ErrorBoundaryProps {
  /** Called with the caught error to produce the fallback UI. */
  fallback: (error: Error) => ReactNode
  children: ReactNode
}


interface ErrorBoundaryState {
  error: Error | null
}


export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }


  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }


  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep this `console.error` — surfacing the stack in the iframe's
    // devtools is the main debugging affordance the user has when an
    // agent-written widget breaks.
    console.error("[mini-app-runtime] render error:", error, info)
  }


  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error)
    }
    return this.props.children
  }
}
