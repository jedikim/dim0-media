import { describe, expect, it } from "vitest"
import { ByokLlmClient, type ByokConfig } from "../byok-client"
import { ManagedLlmClient } from "../managed-client"
import { resolveAgentLlm } from "./local-llm"


const cfg: ByokConfig = { provider: "openrouter", apiKey: "sk-x", model: "openai/gpt-5.4" }


describe("resolveAgentLlm — 'our keys first'", () => {
  it("signed in + saved key → managed (our keys supersede a saved key)", () => {
    expect(resolveAgentLlm(cfg, { signedIn: true })).toBeInstanceOf(ManagedLlmClient)
  })

  it("signed out + saved key → BYOK (their key, since managed is unavailable)", () => {
    expect(resolveAgentLlm(cfg, { signedIn: false })).toBeInstanceOf(ByokLlmClient)
  })

  it("signed in, no key → managed (our keys, no BYOK needed)", () => {
    expect(resolveAgentLlm(null, { signedIn: true })).toBeInstanceOf(ManagedLlmClient)
  })

  it("signed out, no key → null (caller shows 'set your API key')", () => {
    expect(resolveAgentLlm(null, { signedIn: false })).toBeNull()
  })
})
