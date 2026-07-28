import { describe, expect, it } from "vitest"
import { validateMiniAppSource } from "./validate"


describe("validateMiniAppSource", () => {
  it("accepts a well-formed Widget", () => {
    expect(validateMiniAppSource("function Widget() { return <div>hi</div> }")).toEqual({ ok: true })
  })


  it("accepts an arrow App", () => {
    expect(validateMiniAppSource("const App = () => <div/>")).toEqual({ ok: true })
  })


  it("rejects a syntax error with a line/col", () => {
    const r = validateMiniAppSource("function Widget() { return <div>")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(typeof r.line).toBe("number")
  })


  it("rejects source with no Widget/App component", () => {
    const r = validateMiniAppSource("const x = 1")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/Widget or App/)
  })
})
