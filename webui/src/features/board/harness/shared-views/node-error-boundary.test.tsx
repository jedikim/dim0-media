// Tests for the per-node error boundary used by render-view dispatch.
//
// The harness has no @testing-library/react dependency; existing tests
// in this repo are pure-function. We use vanilla `react-dom/client`
// against a jsdom container so the boundary's getDerivedStateFromError
// + componentDidCatch are exercised against a real React commit.
//
// Render is wrapped in `act` so React processes state transitions
// before assertions look at the DOM.

import { StrictMode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NodeErrorBoundary } from "./node-error-boundary"


function Boom({ message }: { message: string }): never {
  throw new Error(message)
}


describe("NodeErrorBoundary", () => {
  let container: HTMLDivElement
  let root: Root
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    // React 19 logs caught render errors via console.error even when a
    // boundary handles them, plus our own componentDidCatch logs. Stub
    // so the test output stays readable; restore in afterEach.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })


  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    consoleErrorSpy.mockRestore()
  })


  it("renders children verbatim when nothing throws", () => {
    act(() => {
      root.render(
        <NodeErrorBoundary nodeType="sheet">
          <span data-testid="ok">ok</span>
        </NodeErrorBoundary>,
      )
    })
    expect(container.querySelector('[data-testid="ok"]')?.textContent).toBe("ok")
  })


  it("catches a child render error and shows the typed fallback", () => {
    act(() => {
      root.render(
        <NodeErrorBoundary nodeType="mini-app">
          <Boom message="kaboom" />
        </NodeErrorBoundary>,
      )
    })
    expect(container.textContent).toContain("mini-app failed to render")
    expect(container.textContent).toContain("kaboom")
  })


  it("falls back to a generic label when nodeType is omitted", () => {
    act(() => {
      root.render(
        <NodeErrorBoundary>
          <Boom message="oops" />
        </NodeErrorBoundary>,
      )
    })
    expect(container.textContent).toContain("Node failed to render")
  })


  it("logs the error with the nodeId tag so it's grep-able in devtools", () => {
    act(() => {
      root.render(
        <NodeErrorBoundary nodeId="abc123" nodeType="mini-app">
          <Boom message="trace me" />
        </NodeErrorBoundary>,
      )
    })
    const calls = consoleErrorSpy.mock.calls.map((args: unknown[]) => String(args[0]))
    // React itself adds noise; assert against our own tagged log line.
    expect(calls.some((s: string) => s.includes("[node mini-app abc123] render failed:"))).toBe(true)
  })


  it("isolates failures — a thrown sibling doesn't kill a healthy one", () => {
    // Two boundaries in the same tree. One child throws, the other
    // renders normally. The fallback should appear without disturbing
    // the sibling.
    act(() => {
      root.render(
        <StrictMode>
          <div>
            <NodeErrorBoundary nodeType="bad">
              <Boom message="bad node" />
            </NodeErrorBoundary>
            <NodeErrorBoundary nodeType="good">
              <span data-testid="ok">healthy</span>
            </NodeErrorBoundary>
          </div>
        </StrictMode>,
      )
    })
    expect(container.querySelector('[data-testid="ok"]')?.textContent).toBe("healthy")
    expect(container.textContent).toContain("bad failed to render")
  })
})
