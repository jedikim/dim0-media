import { describe, expect, it } from "vitest"
import type { BoardMeta } from "@/features/board/model"
import { resolveSyncEngine } from "./use-sync-engine"


const meta = (syncEngine?: "legacy" | "v2"): BoardMeta => ({
  id: "b1",
  title: "B",
  kind: "synced",
  syncEngine,
  visibility: "private",
  createdAt: 0,
  updatedAt: 0,
})


describe("resolveSyncEngine", () => {
  it("defaults to legacy when no meta and no override (untouched backend board)", () => {
    expect(resolveSyncEngine(undefined, false)).toBe("legacy")
  })

  it("reads the stored engine from meta", () => {
    expect(resolveSyncEngine(meta("v2"), false)).toBe("v2")
    expect(resolveSyncEngine(meta("legacy"), false)).toBe("legacy")
  })

  it("treats meta without syncEngine as legacy", () => {
    expect(resolveSyncEngine(meta(undefined), false)).toBe("legacy")
  })

  it("dev override forces v2 regardless of stored engine or missing meta", () => {
    expect(resolveSyncEngine(undefined, true)).toBe("v2")
    expect(resolveSyncEngine(meta("legacy"), true)).toBe("v2")
    expect(resolveSyncEngine(meta("v2"), true)).toBe("v2")
  })
})
