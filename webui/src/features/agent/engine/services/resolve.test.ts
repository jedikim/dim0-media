import { describe, expect, it } from "vitest"
import type { ByokCredential, ResolveContext, ServiceKind } from "./kinds"
import { SERVICE_KINDS } from "./kinds"
import { resolveAllServices, resolveService } from "./resolve"


const key: ByokCredential = { provider: "openrouter", apiKey: "sk-abc", model: "openai/gpt-5.4" }

const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  signedIn: false,
  byok: {},
  ...over,
})

const modeOf = (kind: ServiceKind, over: Partial<ResolveContext> = {}) =>
  resolveService(kind, ctx(over)).mode


describe("resolveService", () => {
  it("off: logged out, no key", () => {
    expect(modeOf("llm")).toBe("off")
  })

  it("byok: key present, logged out", () => {
    expect(modeOf("llm", { byok: { llm: key } })).toBe("byok")
  })

  it("byok wins by default: key present AND signed in (never silently metered)", () => {
    expect(modeOf("llm", { signedIn: true, byok: { llm: key } })).toBe("byok")
  })

  it("managed: signed in, no key", () => {
    expect(modeOf("llm", { signedIn: true })).toBe("managed")
  })

  it("preferManaged flips to managed even with a key (opt-in metering)", () => {
    const r = resolveService("llm", ctx({ signedIn: true, byok: { llm: key }, preferManaged: true }))
    expect(r.mode).toBe("managed")
    // carries the byok provider/model as a hint for the managed request
    if (r.mode === "managed") {
      expect(r.provider).toBe("openrouter")
      expect(r.model).toBe("openai/gpt-5.4")
    }
  })

  it("preferManaged but signed out falls back to the key", () => {
    expect(modeOf("llm", { byok: { llm: key }, preferManaged: true })).toBe("byok")
  })

  it("preferManaged, signed out, no key → off", () => {
    expect(modeOf("llm", { preferManaged: true })).toBe("off")
  })

  it("managedAllowed veto: signed in but kind disallowed → off (no key)", () => {
    expect(modeOf("code", { signedIn: true, managedAllowed: () => false })).toBe("off")
  })

  it("managedAllowed veto falls back to the key when present", () => {
    expect(modeOf("code", { signedIn: true, managedAllowed: () => false, byok: { code: { provider: "daytona", apiKey: "k" } } })).toBe("byok")
  })

  it("blank/whitespace apiKey is not a usable key", () => {
    expect(modeOf("llm", { byok: { llm: { provider: "openai", apiKey: "   " } } })).toBe("off")
  })

  it("resolves each kind independently (per-kind byok)", () => {
    const r = resolveAllServices(ctx({
      signedIn: true,
      byok: { search: { provider: "tavily", apiKey: "t" } },
      managedAllowed: (k) => k !== "fetch", // fetch vetoed by plan
    }))
    expect(r.search.mode).toBe("byok")   // own key
    expect(r.llm.mode).toBe("managed")   // signed in, no key
    expect(r.fetch.mode).toBe("off")     // vetoed + no key
    expect(r.code.mode).toBe("managed")
  })

  it("resolveAllServices covers every kind", () => {
    const r = resolveAllServices(ctx())
    expect(Object.keys(r).sort()).toEqual([...SERVICE_KINDS].sort())
  })
})
