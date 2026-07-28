import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { engineCases } from "@/test/engines"
import type { StorageEngine } from "@/features/board/persist/local/engine"
import { MiniAppRepo } from "./mini-app-repo"


// Run the full MiniAppRepo suite against every StorageEngine.
for (const { label, make } of engineCases) describe(`MiniAppRepo (${label})`, () => {
  let engine: StorageEngine
  let repo: MiniAppRepo


  beforeEach(async () => {
    engine = await make()
    repo = new MiniAppRepo(engine)
  })


  afterEach(() => {
    engine.close()
  })

  it("round-trips per-note state", async () => {
    await repo.putState("n1", { count: 3 })
    expect(await repo.getState("n1")).toEqual({ count: 3 })
  })


  it("returns undefined for a note with no state", async () => {
    expect(await repo.getState("ghost")).toBeUndefined()
  })


  it("overwrites previous state and keeps notes isolated", async () => {
    await repo.putState("n1", { v: 1 })
    await repo.putState("n1", { v: 2 })
    await repo.putState("n2", { other: true })
    expect(await repo.getState("n1")).toEqual({ v: 2 })
    expect(await repo.getState("n2")).toEqual({ other: true })
  })


  it("maps a stored null to undefined (host-contract: no initial state)", async () => {
    await repo.putState("n1", null)
    // The host treats null like absent — a widget gets no initialState either way.
    expect(await repo.getState("n1")).toBeUndefined()
  })


  it("deleteState removes a note's state", async () => {
    await repo.putState("n1", { v: 1 })
    await repo.deleteState("n1")
    expect(await repo.getState("n1")).toBeUndefined()
  })
})
