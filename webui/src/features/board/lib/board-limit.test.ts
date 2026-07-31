import { afterEach, describe, expect, it } from "vitest"
import { useAppStore } from "@/store"
import {
  canCreateSubBoard,
  isBoardCreationLimited,
  isNodeTypeAtLimit,
  MAX_BOARD_DEPTH,
  nodeLimitFor,
} from "./board-limit"


// The billing gate now reads the backend-authoritative `billingActive` from the
// app store (not the raw VITE flag), so drive it directly.
function setBillingActive(active: boolean) {
  useAppStore.setState({ billingActive: active })
}


afterEach(() => {
  setBillingActive(false)
})


describe("node limits — billing active", () => {
  it("resolves per-plan limits for documents, mini-apps and code sandboxes", () => {
    setBillingActive(true)
    expect(nodeLimitFor("document", "free")).toBe(3)
    expect(nodeLimitFor("document", "plus")).toBe(25)
    expect(nodeLimitFor("mini-app", "free")).toBe(10)
    expect(nodeLimitFor("mini-app", "plus")).toBe(100)
    expect(nodeLimitFor("code-sandbox", "basic")).toBe(60)
  })

  it("treats folders as a universal limit regardless of plan", () => {
    setBillingActive(true)
    expect(nodeLimitFor("folder", "free")).toBe(10)
    expect(nodeLimitFor("folder", "plus")).toBe(10)
  })

  it("flags a type as at-limit only once the count reaches the cap", () => {
    setBillingActive(true)
    expect(isNodeTypeAtLimit("document", "free", 2)).toBe(false)
    expect(isNodeTypeAtLimit("document", "free", 3)).toBe(true)
    expect(isNodeTypeAtLimit("mini-app", "plus", 99)).toBe(false)
    expect(isNodeTypeAtLimit("mini-app", "plus", 100)).toBe(true)
  })

  it("returns null (unlimited) for unknown types", () => {
    setBillingActive(true)
    expect(nodeLimitFor("rect", "free")).toBeNull()
  })

  it("enforces the free board cap when billing is active", () => {
    setBillingActive(true)
    expect(isBoardCreationLimited("free", 4)).toBe(false)
    expect(isBoardCreationLimited("free", 5)).toBe(true)
    expect(isBoardCreationLimited("plus", 999)).toBe(false) // unlimited plan
  })
})


describe("node limits — billing inactive (OSS)", () => {
  it("drops per-plan limits to unlimited but keeps universal folder limit", () => {
    setBillingActive(false)
    expect(nodeLimitFor("document", "free")).toBeNull()
    expect(nodeLimitFor("mini-app", "free")).toBeNull()
    expect(isNodeTypeAtLimit("document", "free", 999)).toBe(false)
    // folders are a structural guardrail — enforced even in OSS
    expect(nodeLimitFor("folder", "free")).toBe(10)
    expect(isNodeTypeAtLimit("folder", "free", 10)).toBe(true)
  })

  it("never limits board creation in OSS mode, even for a `free` plan at any count", () => {
    // The reported bug: self-host with a `free`-labelled user was capped at 5.
    setBillingActive(false)
    expect(isBoardCreationLimited("free", 999)).toBe(false)
  })
})


describe("folder nesting depth", () => {
  it("allows root and child levels but blocks a 4th", () => {
    expect(MAX_BOARD_DEPTH).toBe(2)
    expect(canCreateSubBoard(0)).toBe(true) // root
    expect(canCreateSubBoard(1)).toBe(true) // child
    expect(canCreateSubBoard(2)).toBe(false) // child-of-child → no deeper
  })
})
