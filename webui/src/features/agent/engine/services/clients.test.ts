import { describe, expect, it, vi } from "vitest"
import { ByokLlmClient } from "../byok-client"
import type { LlmClient } from "../types"
import type { ServiceResolution } from "./kinds"
import { llmClientFromResolution } from "./clients"


const stubLlm: LlmClient = { complete: async () => ({ kind: "text", text: "" }) }


describe("llmClientFromResolution", () => {
  it("byok → a real ByokLlmClient", () => {
    const r: ServiceResolution = {
      kind: "llm",
      mode: "byok",
      credential: { provider: "openrouter", apiKey: "sk", model: "openai/gpt-5.4" },
    }
    expect(llmClientFromResolution(r)).toBeInstanceOf(ByokLlmClient)
  })

  it("managed → delegates to makeManaged", () => {
    const make = vi.fn(() => stubLlm)
    const r: ServiceResolution = { kind: "llm", mode: "managed", provider: "openai", model: "auto" }
    expect(llmClientFromResolution(r, make)).toBe(stubLlm)
    expect(make).toHaveBeenCalledWith(r)
  })

  it("managed without a maker → null (G2 not wired yet)", () => {
    const r: ServiceResolution = { kind: "llm", mode: "managed" }
    expect(llmClientFromResolution(r)).toBeNull()
  })

  it("off → null", () => {
    expect(llmClientFromResolution({ kind: "llm", mode: "off" })).toBeNull()
  })

  it("non-llm kind → null", () => {
    const r: ServiceResolution = { kind: "search", mode: "byok", credential: { provider: "tavily", apiKey: "t" } }
    expect(llmClientFromResolution(r)).toBeNull()
  })
})
