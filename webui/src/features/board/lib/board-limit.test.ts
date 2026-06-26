import { afterEach, describe, expect, it, vi } from "vitest"


afterEach(() => {
  vi.resetModules()
  vi.doUnmock("@/config/billing")
})


async function loadWith(billingEnabled: boolean) {
  vi.resetModules()
  vi.doMock("@/config/billing", () => ({ BILLING_ENABLED: billingEnabled }))
  return import("./board-limit")
}


describe("node limits — billing active", () => {
  it("resolves per-plan limits for documents, mini-apps and code sandboxes", async () => {
    const { nodeLimitFor } = await loadWith(true)
    expect(nodeLimitFor("document", "free")).toBe(3)
    expect(nodeLimitFor("document", "plus")).toBe(25)
    expect(nodeLimitFor("mini-app", "free")).toBe(10)
    expect(nodeLimitFor("mini-app", "plus")).toBe(100)
    expect(nodeLimitFor("code-sandbox", "basic")).toBe(60)
  })

  it("treats folders as a universal limit regardless of plan", async () => {
    const { nodeLimitFor } = await loadWith(true)
    expect(nodeLimitFor("folder", "free")).toBe(10)
    expect(nodeLimitFor("folder", "plus")).toBe(10)
  })

  it("flags a type as at-limit only once the count reaches the cap", async () => {
    const { isNodeTypeAtLimit } = await loadWith(true)
    expect(isNodeTypeAtLimit("document", "free", 2)).toBe(false)
    expect(isNodeTypeAtLimit("document", "free", 3)).toBe(true)
    expect(isNodeTypeAtLimit("mini-app", "plus", 99)).toBe(false)
    expect(isNodeTypeAtLimit("mini-app", "plus", 100)).toBe(true)
  })

  it("returns null (unlimited) for unknown types", async () => {
    const { nodeLimitFor } = await loadWith(true)
    expect(nodeLimitFor("rect", "free")).toBeNull()
  })
})


describe("node limits — billing inactive (OSS)", () => {
  it("drops per-plan limits to unlimited but keeps universal folder limit", async () => {
    const { nodeLimitFor, isNodeTypeAtLimit } = await loadWith(false)
    expect(nodeLimitFor("document", "free")).toBeNull()
    expect(nodeLimitFor("mini-app", "free")).toBeNull()
    expect(isNodeTypeAtLimit("document", "free", 999)).toBe(false)
    // folders are a structural guardrail — enforced even in OSS
    expect(nodeLimitFor("folder", "free")).toBe(10)
    expect(isNodeTypeAtLimit("folder", "free", 10)).toBe(true)
  })
})


describe("folder nesting depth", () => {
  it("allows root and child levels but blocks a 4th", async () => {
    const { canCreateSubBoard, MAX_BOARD_DEPTH } = await loadWith(true)
    expect(MAX_BOARD_DEPTH).toBe(2)
    expect(canCreateSubBoard(0)).toBe(true) // root
    expect(canCreateSubBoard(1)).toBe(true) // child
    expect(canCreateSubBoard(2)).toBe(false) // child-of-child → no deeper
  })
})
