import * as React from "react"
import { describe, expect, it } from "vitest"

import { compileMiniApp } from "./compile"


// Mock components used in a few cases to verify scope injection. We
// don't depend on the real Card/Button here — that keeps these tests
// fast and independent of the component library.
const Card = ({ children }: { children?: React.ReactNode }) =>
  React.createElement("div", { "data-card": true }, children)


describe("compileMiniApp", () => {
  it("compiles a trivial Widget", () => {
    const result = compileMiniApp(
      "function Widget() { return React.createElement('div', null, 'hi') }",
      { React },
    )
    expect(result.ok).toBe(true)
  })


  it("compiles JSX through the classic runtime", () => {
    // No explicit React.createElement — sucrase's classic JSX transform
    // emits it. This proves the classic-mode config + React-in-scope.
    const result = compileMiniApp(
      "function Widget() { return <div>hi</div> }",
      { React },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      const out = result.Component() as React.ReactElement
      expect(out.type).toBe("div")
    }
  })


  it("accepts identifiers from scope", () => {
    const result = compileMiniApp(
      "function Widget() { return <Card>hi</Card> }",
      { React, Card },
    )
    expect(result.ok).toBe(true)
  })


  it("supports the alternative `App` export name", () => {
    const result = compileMiniApp(
      "function App() { return <div/> }",
      { React },
    )
    expect(result.ok).toBe(true)
  })


  it("supports arrow-const Widget definitions", () => {
    const result = compileMiniApp(
      "const Widget = () => <div/>",
      { React },
    )
    expect(result.ok).toBe(true)
  })


  it("returns a compile error on syntax mistakes", () => {
    const result = compileMiniApp(
      "function Widget(  return <div/>",
      { React },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("compile")
    }
  })


  it("includes a line + column for sucrase syntax errors", () => {
    // Bad token on line 3 — sucrase will report a position.
    const result = compileMiniApp(
      "function Widget() {\n  const x = 1\n  return <\n}",
      { React },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("compile")
      expect(typeof result.error.line).toBe("number")
    }
  })


  it("returns a compile error when no Widget or App is defined", () => {
    const result = compileMiniApp("const x = 1", { React })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("compile")
      expect(result.error.message).toMatch(/no Widget or App/i)
    }
  })


  it("compiles cleanly when the source references an unknown identifier", () => {
    // Unknown identifiers are a *runtime* concern — they don't fail
    // compile, they fail when the component renders. This test pins
    // that contract.
    const result = compileMiniApp(
      "function Widget() { return <div>{unknownThing}</div> }",
      { React },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(() => result.Component()).toThrow(/unknownThing/)
    }
  })


  it("reports a runtime error if the top-level body throws", () => {
    const result = compileMiniApp(
      "throw new Error('boom'); function Widget() { return null }",
      { React },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("runtime")
      expect(result.error.message).toMatch(/boom/)
    }
  })


  it("rejects an empty source string", () => {
    const result = compileMiniApp("", { React })
    expect(result.ok).toBe(false)
  })
})
