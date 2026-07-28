import { describe, expect, it } from "vitest"
import { resetIdb } from "@/test/canvas"
import { isKeyRange } from "./engine"
import type { Key } from "./engine"
import { IndexedDbEngine, toIdbRange } from "./indexeddb-engine"
import { InMemoryEngine } from "./in-memory-engine"
import { runEngineContract } from "./engine-contract"


// The port contract, run against every implementation. Both must behave
// identically — that parity is what makes a future SQLite adapter a safe swap.
runEngineContract("IndexedDbEngine", async () => {
  resetIdb()
  return IndexedDbEngine.open()
})

runEngineContract("InMemoryEngine", () => Promise.resolve(new InMemoryEngine()))


// IndexedDB-specific helpers (not part of the port).
describe("isKeyRange", () => {
  it("treats scalars and compound keys as plain keys", () => {
    expect(isKeyRange("b1")).toBe(false)
    expect(isKeyRange(7)).toBe(false)
    expect(isKeyRange(["b", 1])).toBe(false)
  })


  it("treats a bounds object as a range", () => {
    expect(isKeyRange({ lower: "a" })).toBe(true)
    expect(isKeyRange({ lower: "a", upper: "z", upperOpen: true })).toBe(true)
  })
})


describe("toIdbRange", () => {
  it("builds bounded, lower-only and upper-only ranges", () => {
    expect(toIdbRange({ lower: "a", upper: "z" })).toBeInstanceOf(IDBKeyRange)
    expect(toIdbRange({ lower: "a" }).upper).toBeUndefined()
    expect(toIdbRange({ upper: "z" }).lower).toBeUndefined()
  })


  it("honours open bounds", () => {
    const r = toIdbRange({ lower: "a", upper: "z", lowerOpen: true, upperOpen: true })
    expect(r.lowerOpen).toBe(true)
    expect(r.upperOpen).toBe(true)
  })


  it("throws when no bound is given", () => {
    expect(() => toIdbRange({})).toThrow(/at least one/)
  })
})


// Type-level sanity: Key includes scalars and compound keys.
const _keys: Key[] = ["s", 1, ["a", 2]]
void _keys
