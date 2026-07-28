import { describe, expect, it } from "vitest"
import type { ToolCallStep } from "./stream"
import { ToolNameIcon, canonicalToolName, normalizeReasoningStep } from "./stream"


describe("canonicalToolName", () => {
  it("aliases the legacy 'navigate' name to 'fetch'", () => {
    expect(canonicalToolName("navigate")).toBe("fetch")
  })

  it("passes a canonical name through unchanged", () => {
    expect(canonicalToolName("web_search")).toBe("web_search")
  })
})


describe("normalizeReasoningStep", () => {
  it("rewrites a legacy 'navigate' tool step to 'fetch' (resolves a real icon)", () => {
    // A persisted legacy step carries the retired "navigate" name.
    const legacy = { type: "tool_call", id: "s1", name: "navigate", thought: "", output: "", state: "completed", eventMessages: [] } as unknown as ToolCallStep
    const step = normalizeReasoningStep(legacy)
    expect(step.type === "tool_call" && step.name).toBe("fetch")
    expect(ToolNameIcon.fetch).toBeDefined()
  })
})
