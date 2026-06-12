// Guards that every Dim0 custom node type is treated as "custom" by BOTH
// consumer paths: the double-click handler (no inline beginEdit) and the
// sticky style memory (no style bleed). Regression cover for mini-app,
// which was added to node-types but missed in both sets.
//
// We assert against a local list rather than importing `boardNodeTypes`
// directly — that registry pulls in every iframe-backed node view and adds
// ~12s of import cost to the suite. Keep this list in sync with
// `node-types/index.ts → boardNodeTypes`.
import { describe, expect, it } from "vitest"
import { CUSTOM_NODE_TYPES } from "./custom-node-types"
import { isStylableNodeType } from "./use-style-memory"


const EXPECTED_CUSTOM_TYPES = [
  "folder",
  "document",
  "widget",
  "mini-app",
  "code-sandbox",
  "sheet",
].sort()


describe("custom node type exclusions", () => {
  it("registers every custom node type for the dbl-click override", () => {
    expect([...CUSTOM_NODE_TYPES].sort()).toEqual(EXPECTED_CUSTOM_TYPES)
  })


  it("excludes every custom node type from sticky style memory", () => {
    for (const type of EXPECTED_CUSTOM_TYPES) {
      expect(isStylableNodeType(type)).toBe(false)
    }
  })


  it("keeps the two exclusion sets in agreement (no type custom in one path only)", () => {
    for (const type of CUSTOM_NODE_TYPES) {
      expect(isStylableNodeType(type)).toBe(false)
    }
  })


  it("covers mini-app specifically (the original gap)", () => {
    expect(CUSTOM_NODE_TYPES.has("mini-app")).toBe(true)
    expect(isStylableNodeType("mini-app")).toBe(false)
  })


  it("leaves built-in primitive types editable + stylable", () => {
    expect(CUSTOM_NODE_TYPES.has("rect")).toBe(false)
    expect(isStylableNodeType("rect")).toBe(true)
  })
})
