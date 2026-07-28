import { describe, expect, it } from "vitest"
import type { ByokConfig } from "../byok-client"
import { agentResolveContext } from "./context"
import { resolveAllServices } from "./resolve"


const cfg: ByokConfig = { provider: "openrouter", apiKey: "sk-x", model: "openai/gpt-5.4" }


describe("agentResolveContext", () => {
  it("signed in → preferManaged true (our keys first)", () => {
    const ctx = agentResolveContext({ signedIn: true, llm: cfg })
    expect(ctx.signedIn).toBe(true)
    expect(ctx.preferManaged).toBe(true)
    expect(ctx.byok.llm).toEqual({ provider: "openrouter", apiKey: "sk-x", model: "openai/gpt-5.4" })
  })

  it("signed out → preferManaged false (fall back to the key)", () => {
    expect(agentResolveContext({ signedIn: false, llm: cfg }).preferManaged).toBe(false)
  })

  it("maps per-service keys into the byok map", () => {
    const ctx = agentResolveContext({
      signedIn: false,
      search: { engine: "exa", apiKey: "exa-k" },
      code: "dtn-k",
    })
    expect(ctx.byok.search).toEqual({ provider: "exa", apiKey: "exa-k" })
    expect(ctx.byok.code).toEqual({ provider: "daytona", apiKey: "dtn-k" })
  })

  it("no keys → empty byok map", () => {
    expect(agentResolveContext({ signedIn: true }).byok).toEqual({})
    expect(agentResolveContext({ signedIn: false, llm: null }).byok).toEqual({})
  })
})


// The panel and the submit loop share this context, so assert the whole matrix
// end-to-end (context → resolveAllServices) matches "our keys first" + BYOK-all.
describe("resolveAllServices via agentResolveContext", () => {
  it("signed in + saved model key → managed for every service", () => {
    const r = resolveAllServices(agentResolveContext({ signedIn: true, llm: cfg }))
    expect(r.llm.mode).toBe("managed")
    expect(r.search.mode).toBe("managed")
    expect(r.code.mode).toBe("managed")
    expect(r.fetch.mode).toBe("managed")
  })

  it("signed out + model key → BYOK llm, managed-only services off unless keyed", () => {
    const r = resolveAllServices(agentResolveContext({ signedIn: false, llm: cfg }))
    expect(r.llm.mode).toBe("byok")
    expect(r.search.mode).toBe("off")
    expect(r.code.mode).toBe("off")
  })

  it("signed out + per-service keys → those services resolve to byok (relayed)", () => {
    const r = resolveAllServices(
      agentResolveContext({
        signedIn: false,
        search: { engine: "exa", apiKey: "exa-k" },
        code: "dtn-k",
      }),
    )
    expect(r.search.mode).toBe("byok")
    expect(r.code.mode).toBe("byok")
    expect(r.llm.mode).toBe("off") // no model key
  })

  it("signed out, no keys → everything off", () => {
    const r = resolveAllServices(agentResolveContext({ signedIn: false }))
    expect(r.llm.mode).toBe("off")
    expect(r.search.mode).toBe("off")
  })
})
