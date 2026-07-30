import { beforeEach, describe, expect, it } from "vitest"
import { loadToolTrust, useToolTrustStore } from "./tool-trust-store"


const KEY = "dim0.tool_trust"


beforeEach(() => {
  localStorage.clear()
  useToolTrustStore.setState({ autoAllow: { web_search: false, fetch: false, code_interpreter: false } })
})


describe("useToolTrustStore", () => {
  it("defaults every off-board tool to off (gate on)", () => {
    const { isAutoAllowed } = useToolTrustStore.getState()
    expect(isAutoAllowed("web_search")).toBe(false)
    expect(isAutoAllowed("fetch")).toBe(false)
    expect(isAutoAllowed("code_interpreter")).toBe(false)
  })

  it("grants per tool, independently — trusting one doesn't trust the others", () => {
    useToolTrustStore.getState().setAutoAllow("web_search", true)
    const { isAutoAllowed } = useToolTrustStore.getState()
    expect(isAutoAllowed("web_search")).toBe(true)
    expect(isAutoAllowed("fetch")).toBe(false)
    expect(isAutoAllowed("code_interpreter")).toBe(false)
  })

  it("persists the whole grant map and reads back the change", () => {
    useToolTrustStore.getState().setAutoAllow("code_interpreter", true)
    expect(useToolTrustStore.getState().isAutoAllowed("code_interpreter")).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ code_interpreter: true })
  })

  it("toggling back off persists too (revocable)", () => {
    useToolTrustStore.getState().setAutoAllow("fetch", true)
    useToolTrustStore.getState().setAutoAllow("fetch", false)
    expect(useToolTrustStore.getState().isAutoAllowed("fetch")).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ fetch: false })
  })

  it("isAutoAllowed is safe for an unknown tool name", () => {
    expect(useToolTrustStore.getState().isAutoAllowed("create_note")).toBe(false)
  })

  it("persists independently of any BYOK key (managed-mode users keep the grant)", () => {
    // Regression guard for why this isn't in byok-store, whose persist() drops
    // everything when no key is set.
    useToolTrustStore.getState().setAutoAllow("web_search", true)
    expect(localStorage.getItem(KEY)).toBeTruthy()
    expect(localStorage.getItem("dim0.byok")).toBeNull()
  })
})


describe("loadToolTrust (rehydration)", () => {
  it("returns all-off when nothing is stored", () => {
    localStorage.clear()
    expect(loadToolTrust()).toEqual({ web_search: false, fetch: false, code_interpreter: false })
  })

  it("rehydrates a stored grant map", () => {
    localStorage.setItem(KEY, JSON.stringify({ web_search: true, code_interpreter: true }))
    expect(loadToolTrust()).toEqual({ web_search: true, fetch: false, code_interpreter: true })
  })

  it("coerces a partial payload — missing keys default to off", () => {
    localStorage.setItem(KEY, JSON.stringify({ fetch: true }))
    expect(loadToolTrust()).toEqual({ web_search: false, fetch: true, code_interpreter: false })
  })

  it("falls back to all-off on corrupt (non-JSON) storage — never throws", () => {
    localStorage.setItem(KEY, "{not json")
    expect(() => loadToolTrust()).not.toThrow()
    expect(loadToolTrust()).toEqual({ web_search: false, fetch: false, code_interpreter: false })
  })
})
